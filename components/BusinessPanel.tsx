'use client';
import { COUNTRIES, CountryId, Game, Player } from '@/lib/game';
import { branchActive, isOpenLand, PROVINCES, PROVINCE_BY_ID } from '@/lib/politics';
export default function BusinessPanel({ game, me, country, provinceId, setProvince, disabled, action }: {
  game: Game; me: Player; country: CountryId; provinceId: string; setProvince: (id: string) => void;
  disabled: boolean; action: (a: Record<string, unknown>) => void;
}) {
  const info = PROVINCE_BY_ID[provinceId], province = game.politics.provinces[provinceId];
  const existing = game.branches.find(b => b.province === provinceId), mine = game.branches.filter(b => b.owner === me.id);
  const eligible = isOpenLand(game, provinceId) && !existing;
  return <div className="tab-content"><div className="section-heading"><div><h2>Build beyond your borders</h2><p>Open branches on peaceful, unconquered land—even without a government. No land seizure, new company grant or passive income.</p></div><span className="tag">{mine.length}/6 BRANCHES</span></div>
    <article className="activity-card branch-founder"><label className="field">Business location · {COUNTRIES.find(c => c.id === country)!.name}<select aria-label="Branch province" value={provinceId} onChange={e => setProvince(e.target.value)}>{PROVINCES.filter(p => p.country === country).map(p => <option key={p.id} value={p.id}>{p.name}{game.branches.some(b => b.province === p.id) ? ' · branch occupied' : ''}</option>)}</select></label><p>{existing ? `Branch operated by ${game.players[existing.owner].name}.` : eligible ? 'Available site. This province remains under its original country’s control and is at peace.' : 'Unavailable: war, rebellion or foreign occupation. Choose peaceful original-country territory.'}</p><button className="button primary" disabled={disabled || !eligible || mine.length >= 6} onClick={() => action({ type: 'open-branch', province: provinceId, version: province.version })}>Open branch · 2 machines + 2 provisions</button></article>
    <div className="contract-list">{mine.map(branch => {
      const region = PROVINCE_BY_ID[branch.province], c = COUNTRIES.find(c => c.id === region.country)!, active = branchActive(game, branch);
      return <article className="branch-card" key={branch.id}><div><h3>{region.name} · {c.name}</h3><p>{active ? 'Operational · manual extraction and destination freight access' : 'Suspended by war, rebellion or occupation · assets remain yours'}</p><p>Shared reserves: {game.reserves[c.id].ore} ore · {game.reserves[c.id].grain} grain</p></div><div className="button-group"><button className="button" disabled={disabled || !active} onClick={() => action({ type: 'extract', branch: branch.id, good: 'ore', quantity: Math.min(c.ore, game.reserves[c.id].ore) })}>Extract {c.ore} ore</button><button className="button" disabled={disabled || !active} onClick={() => action({ type: 'extract', branch: branch.id, good: 'grain', quantity: Math.min(c.grain, game.reserves[c.id].grain) })}>Extract {c.grain} grain</button><button className="text-button" disabled={disabled} onClick={() => action({ type: 'close-branch', id: branch.id })}>Close branch</button></div></article>;
    })}</div>{!mine.length && <div className="empty"><span>▦</span><h3>Your company can span the world.</h3><p>Select a country on the map, choose an available province, and open your first branch.</p></div>}
    <p className="hint">One branch slot per province. Setup consumes goods, not credits; closing has no refund. Branch extraction shares the host country's existing reserve. War/occupation suspends access without confiscating holdings. Branches do not grant citizenship, votes, leadership or military command.</p>
  </div>;
}
