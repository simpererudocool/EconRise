'use client';
import { useEffect, useMemo, useState } from 'react';
import { COUNTRIES, CountryId, Game } from '@/lib/game';
import { factionName, PROVINCE_BY_ID } from '@/lib/politics';
type Shape = { id: CountryId | null; name: string; path: string; bounds: number[] };
type Province = Omit<Shape, 'id'> & { id: string; country: CountryId };
type MapData = { countries: Shape[]; provinces: Province[]; borders: { a: string; b: string; path: string }[] };
export default function WorldMap({ selected, onSelect, game, provinceId, onProvince }: {
  selected: CountryId; onSelect: (id: CountryId) => void; game?: Game; provinceId?: string; onProvince: (id: string) => void;
}) {
  const [data, setData] = useState<MapData>(); const [error, setError] = useState('');
  const [detail, setDetail] = useState(false); const [zoom, setZoom] = useState(1); const [offset, setOffset] = useState([0, 0]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/maps/world.json', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('Map unavailable.'); return r.json(); }).then(setData).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, []);
  const base = useMemo(() => {
    if (!detail || !data) return [0, 0, 1080, 510];
    const regions = data.provinces.filter(p => p.country === selected);
    const bounds = [Math.min(...regions.map(p => p.bounds[0])), Math.min(...regions.map(p => p.bounds[1])), Math.max(...regions.map(p => p.bounds[2])), Math.max(...regions.map(p => p.bounds[3]))];
    const width = Math.max(bounds[2] - bounds[0] + 10, 20), height = Math.max(bounds[3] - bounds[1] + 10, 20);
    return [bounds[0] - 5, bounds[1] - 5, width, height];
  }, [detail, data, selected]);
  const view = [base[0] + base[2] / 2 - base[2] / zoom / 2 + offset[0], base[1] + base[3] / 2 - base[3] / zoom / 2 + offset[1], base[2] / zoom, base[3] / zoom];
  const focus = (c: CountryId) => { onSelect(c); setZoom(1); setOffset([0, 0]); };
  const color = (faction: string) => faction.startsWith('rebel:') ? '#c982e9' : COUNTRIES.find(c => c.id === faction)?.color || '#758d9d';
  const warCountries = new Set(game?.politics.wars.flatMap(w => [w.a, w.b]) || []);
  return <div className="geo-map">
    <div className="map-toolbar"><label>Region<select value={selected} onChange={e => focus(e.target.value as CountryId)} aria-label="Map country">{COUNTRIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="button" onClick={() => { setDetail(!detail); setZoom(1); setOffset([0, 0]); }}>{detail ? 'World view' : 'Province view'}</button><div className="map-controls"><button aria-label="Zoom in" onClick={() => setZoom(z => Math.min(z * 1.5, 16))}>+</button><button aria-label="Zoom out" onClick={() => setZoom(z => Math.max(z / 1.5, 1))}>−</button><button aria-label="Pan west" onClick={() => setOffset(o => [o[0] - view[2] / 5, o[1]])}>←</button><button aria-label="Pan east" onClick={() => setOffset(o => [o[0] + view[2] / 5, o[1]])}>→</button><button aria-label="Pan north" onClick={() => setOffset(o => [o[0], o[1] - view[3] / 5])}>↑</button><button aria-label="Pan south" onClick={() => setOffset(o => [o[0], o[1] + view[3] / 5])}>↓</button><button aria-label="Reset map view" onClick={() => { setZoom(1); setOffset([0, 0]); }}>⌂</button></div></div>
    <div className="geo-map-canvas">
      {!data && <div className="empty" role="status">{error || 'Loading local geographic map…'}</div>}
      {data && <svg viewBox={view.join(' ')} aria-label="Geographic world map with player-controlled provinces" role="group">
        <defs><pattern id="occupied" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 6L6 0" stroke="#fff" strokeOpacity=".22" strokeWidth="1"/></pattern></defs>
        {data.countries.map((c, i) => <path key={i} d={c.path} fill={c.id ? c.id === selected ? '#254d4b' : '#263e4d' : '#1b2d3a'} stroke={c.id && warCountries.has(c.id) ? '#d77676' : '#496172'} strokeWidth={c.id ? .9 : .45} vectorEffect="non-scaling-stroke" fillRule="evenodd" role={c.id ? 'button' : undefined} tabIndex={c.id ? 0 : undefined} aria-label={c.id ? `Explore ${c.name}` : undefined} onClick={() => { if (c.id) focus(c.id); }} onKeyDown={e => { if (c.id && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); focus(c.id); } }}><title>{c.name}{c.id && game ? ` · leader: ${game.players[game.politics.governments[c.id].leader || '']?.name || 'ungoverned'}` : ''}</title></path>)}
        {data.provinces.filter(p => !detail || p.country === selected).map(p => {
          const province = game?.politics.provinces[p.id], faction = province?.controller || p.country;
          const occupied = faction !== p.country;
          return <g key={p.id}><path d={p.path} fill={color(faction)} fillOpacity={provinceId === p.id ? .8 : occupied ? .65 : .24} stroke={provinceId === p.id ? '#ecfff7' : '#739298'} strokeOpacity={detail || warCountries.has(p.country) ? .8 : .3} strokeWidth={provinceId === p.id ? 2.4 : .6} vectorEffect="non-scaling-stroke" fillRule="evenodd" role="button" tabIndex={detail ? 0 : -1} aria-label={`Select province ${p.name}`} onClick={() => { focus(p.country); onProvince(p.id); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focus(p.country); onProvince(p.id); } }}><title>{p.name} · {game ? factionName(game, faction) : p.country} · garrison {province?.garrison || 0}</title></path>{occupied && <path d={p.path} fill="url(#occupied)" fillRule="evenodd" pointerEvents="none"/>}</g>;
        })}
        {game && data.borders.filter(b => {
          const a = game.politics.provinces[b.a], other = game.politics.provinces[b.b];
          const homeA = PROVINCE_BY_ID[b.a].country, homeB = PROVINCE_BY_ID[b.b].country;
          const hostileBorder = homeA === homeB || game.politics.wars.some(w => (w.a === homeA && w.b === homeB) || (w.b === homeA && w.a === homeB));
          return a && other && a.controller !== other.controller && (hostileBorder || a.controller !== homeA || other.controller !== homeB);
        }).map((b, i) => <path key={i} d={b.path} className="front-line" fill="none" stroke="#ff796c" strokeWidth="2.5" vectorEffect="non-scaling-stroke" pointerEvents="none"><title>Control frontier</title></path>)}
      </svg>}
    </div>
    <div className="map-legend"><span><i style={{ background: color(selected) }}/>National control</span><span><i style={{ background: '#c982e9' }}/>Rebels</span><span><i style={{ background: '#ff796c' }}/>Control frontier</span><span>Hatching: occupied</span><a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noreferrer">Natural Earth · public domain ↗</a></div>
  </div>;
}
