import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/';
const sources = ['ne_10m_admin_0_countries.geojson', 'ne_10m_admin_1_states_provinces.geojson'];
const catalog = JSON.parse(await readFile('lib/countries.json', 'utf8'));
const countryCodes = Object.fromEntries(catalog.map(c => [c.iso, c.id]));
const capitals = Object.fromEntries(catalog.map(c => [c.id, c.capital]));
const sourceData = await Promise.all(sources.map(async file => {
  // Use the user's local copies. No network access during processing/build/play.
  const localFile = file.replace('.geojson', '.geo.json');
  const text = await readFile(localFile, 'utf8');
  const data = JSON.parse(text);
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error(`Invalid GeoJSON: ${localFile}`);
  return { data, localFile, sha256: createHash('sha256').update(text).digest('hex'), upstreamUrl: base + file };
}));
const [world, admin] = sourceData.map(d => d.data);
const polygons = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
const project = ([lon, lat]) => [(lon + 180) * 3, (85 - lat) * 3];
function simplify(points, tolerance) {
  if (points.length < 5) return points;
  const keep = new Set([0, points.length - 1]); const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop(); let best = tolerance * tolerance, index = -1;
    const [x, y] = points[start], [ex, ey] = points[end], dx = ex - x, dy = ey - y, norm = dx * dx + dy * dy;
    for (let i = start + 1; i < end; i++) {
      const [px, py] = points[i]; const t = norm ? Math.max(0, Math.min(1, ((px - x) * dx + (py - y) * dy) / norm)) : 0;
      const distance = (px - x - t * dx) ** 2 + (py - y - t * dy) ** 2;
      if (distance > best) { best = distance; index = i; }
    }
    if (index >= 0) { keep.add(index); stack.push([start, index], [index, end]); }
  }
  return [...keep].sort((a, b) => a - b).map(i => points[i]);
}
function shape(feature, tolerance) {
  const polys = polygons(feature.geometry); const points = polys.flat(2).map(project);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(n => +n.toFixed(2));
  const path = polys.flatMap(poly => poly.map(ring => {
    const reduced = simplify(ring, tolerance);
    const simple = (reduced.length >= 4 ? reduced : ring).map(project);
    return simple.length >= 4 ? simple.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('') + 'Z' : '';
  })).join('');
  return { path, bounds };
}
const selected = admin.features.filter(f => countryCodes[f.properties.adm0_a3]);
if (!selected.length) throw new Error('No playable subdivisions: inspect upstream schema.');
const regions = selected.map(f => {
  const p = f.properties; const country = countryCodes[p.adm0_a3];
  return { id: `${country}-${p.adm1_code}`, country, name: p.name_en || p.name || p.name_local || p.adm1_code, ...shape(f, .018), neighbors: [], entry: false };
});
// Derive adjacency from unsimplified shared boundary edges, not centroid proximity.
const edges = new Map();
const borderGroups = new Map();
selected.forEach((f, index) => {
  for (const ring of polygons(f.geometry).flat()) for (let i = 1; i < ring.length; i++) {
    const point = p => p.map(n => n.toFixed(5)).join(',');
    const a = point(ring[i - 1]), b = point(ring[i]); if (a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const other = edges.get(key);
    if (other !== undefined && other !== index) {
      regions[index].neighbors.push(regions[other].id); regions[other].neighbors.push(regions[index].id);
      const pair = [regions[index].id, regions[other].id].sort(); const pairKey = pair.join('|');
      if (!borderGroups.has(pairKey)) borderGroups.set(pairKey, { a: pair[0], b: pair[1], segments: [] });
      borderGroups.get(pairKey).segments.push([ring[i - 1], ring[i]]);
    } else if (other === undefined) edges.set(key, index);
  }
});
// Provinces that share exterior edges of their parent country's geometry are
// valid expeditionary entry points (coast OR international land boundary).
const nationalEdges = new Set();
for (const f of world.features.filter(f => countryCodes[f.properties.ISO_A3] || countryCodes[f.properties.ADM0_A3])) {
  for (const ring of polygons(f.geometry).flat()) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1].map(n => n.toFixed(5)).join(','), b = ring[i].map(n => n.toFixed(5)).join(',');
    nationalEdges.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
}
selected.forEach((f, index) => {
  regions[index].entry = polygons(f.geometry).flat().some(ring => ring.some((p, i) => {
    if (!i) return false;
    const a = ring[i - 1].map(n => n.toFixed(5)).join(','), b = p.map(n => n.toFixed(5)).join(',');
    return nationalEdges.has(a < b ? `${a}|${b}` : `${b}|${a}`);
  }));
});
function contains(point, ring) {
  let inside = false; const [x, y] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const capitalIds = {};
for (const [country, point] of Object.entries(capitals)) {
  const index = selected.findIndex((f, i) => regions[i].country === country && polygons(f.geometry).some(poly => contains(point, poly[0]) && !poly.slice(1).some(r => contains(point, r))));
  if (index === -1) throw new Error(`Capital province not found: ${country}`);
  capitalIds[country] = regions[index].id;
}
for (const r of regions) { r.neighbors = [...new Set(r.neighbors)].sort(); if (!r.path || !r.id) throw new Error('Invalid region.'); }
if (new Set(regions.map(r => r.id)).size !== regions.length) throw new Error('Duplicate IDs.');
const countries = world.features.filter(f => f.properties.ADM0_A3 !== 'ATA').map(f => ({
  id: countryCodes[f.properties.ISO_A3] || countryCodes[f.properties.ADM0_A3] || null,
  name: f.properties.NAME_EN || f.properties.NAME, ...shape(f, .10),
}));
// Stitch matching raw boundary edges before simplification so front lines
// follow the source geography instead of decorating whole province outlines.
const borders = [...borderGroups.values()].map(({ a, b, segments }) => {
  const endpoint = p => p.map(n => n.toFixed(5)).join(',');
  const lookup = new Map();
  segments.forEach((segment, i) => segment.forEach(p => { const key = endpoint(p); if (!lookup.has(key)) lookup.set(key, []); lookup.get(key).push(i); }));
  const used = new Set(); const lines = [];
  for (let start = 0; start < segments.length; start++) {
    if (used.has(start)) continue; used.add(start); const line = [...segments[start]];
    for (const reverse of [false, true]) {
      if (reverse) line.reverse();
      while (true) {
        const key = endpoint(line.at(-1)); const next = lookup.get(key).find(i => !used.has(i));
        if (next === undefined) break; used.add(next);
        const segment = segments[next]; line.push(endpoint(segment[0]) === key ? segment[1] : segment[0]);
      }
    }
    lines.push(line);
  }
  return { a, b, path: lines.map(line => simplify(line, .018).map(project).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('')).join('') };
});
await mkdir('public/maps', { recursive: true }); await mkdir('lib', { recursive: true });
await writeFile('public/maps/world.json', JSON.stringify({ version: 'Natural Earth (local copy)', width: 1080, height: 510, countries, provinces: regions, borders }));
await writeFile('lib/territories.json', JSON.stringify({ capitals: capitalIds, provinces: regions.map(({ id, country, name, neighbors, entry }) => ({ id, country, name, neighbors, entry })) }, null, 2) + '\n');
await writeFile('public/maps/sources.json', JSON.stringify({ license: 'Public domain', licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/', processing: 'scripts/build-map.mjs', sources: sourceData.map(({ data, ...rest }) => rest) }, null, 2) + '\n');
console.log('Map built:', countries.length, 'countries;', regions.length, 'playable provinces');
console.log('Per-country provinces:', Object.fromEntries(Object.values(countryCodes).map(c => [c, regions.filter(r => r.country === c).length])));
console.log('Map bytes:', Buffer.byteLength(JSON.stringify({ countries, provinces: regions })));
