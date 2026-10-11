import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { applyAction, COUNTRIES, Game, joinGame, newGame } from '../lib/game';
import { CAPITALS, PROVINCES, rebelFaction, upgradeGame } from '../lib/politics';
import { SqliteStore } from '../lib/store';
import { act, join, snapshot } from '../lib/service';
function fixture() {
  let g = joinGame(newGame(), 'a', 'Atlas', 'canada');
  g = joinGame(g, 'b', 'Boreal', 'canada'); g = joinGame(g, 'c', 'Cobalt', 'brazil');
  // Explicit unit fixtures are not runtime actors or grants.
  for (const p of Object.values(g.players)) { p.goods.machines = 100; p.goods.provisions = 150; }
  return g;
}
function command(g: Game, who: string, type: string, province: string, units: number) {
  return applyAction(g, who, { type, province, units, version: g.politics.provinces[province].version });
}
test('local map data has valid stable IDs, capitals, symmetric true-border adjacency and compact assets', () => {
  const data = JSON.parse(readFileSync('public/maps/world.json', 'utf8'));
  assert.equal(data.provinces.length, PROVINCES.length); assert.equal(PROVINCES.length, 1060); assert.equal(COUNTRIES.length, 24);
  assert.ok(statSync('public/maps/world.json').size < 4 * 1024 * 1024);
  const ids = new Set(PROVINCES.map(p => p.id)); assert.equal(ids.size, PROVINCES.length);
  for (const [country, id] of Object.entries(CAPITALS)) assert.equal(PROVINCES.find(p => p.id === id)?.country, country);
  for (const p of PROVINCES) for (const n of p.neighbors) { assert.ok(ids.has(n)); assert.ok(PROVINCES.find(r => r.id === n)!.neighbors.includes(p.id)); }
  assert.ok(data.borders.length > 200); for (const b of data.borders) { assert.ok(ids.has(b.a) && ids.has(b.b)); assert.ok(b.path.startsWith('M')); }
  for (const p of data.provinces) { assert.ok(p.path.startsWith('M')); assert.ok(p.bounds.every(Number.isFinite)); }
});
test('schema-1 migration preserves economic state and creates no leader, goods or credit', () => {
  const g = fixture(); const { politics, ...legacy } = g; void politics;
  const old = { ...legacy, schema: 1 } as unknown as Game; const upgraded = upgradeGame(old);
  assert.equal(upgraded.schema, 3); assert.deepEqual(upgraded.players, old.players); assert.equal(upgraded.revision, old.revision);
  assert.ok(Object.values(upgraded.politics.governments).every(g => !g.leader));
  assert.equal(upgradeGame(upgraded), upgraded);
});
test('schema-2 expansion preserves leaders, occupations, spent reserves and balances', () => {
  let g = applyAction(fixture(), 'a', { type: 'claim-government' });
  g.reserves.canada.ore = 123;
  const provinces = Object.fromEntries(Object.entries(g.politics.provinces).filter(([id]) => !id.startsWith('usa-')));
  const governments = { ...g.politics.governments }; delete (governments as Partial<typeof governments>).usa;
  const reserves = { ...g.reserves }; delete (reserves as Partial<typeof reserves>).usa;
  const { branches, ...old } = g; void branches;
  const upgraded = upgradeGame({ ...old, schema: 2, reserves, politics: { ...old.politics, governments, provinces } } as unknown as Game);
  assert.equal(upgraded.politics.governments.canada.leader, 'a'); assert.equal(upgraded.politics.governments.usa.leader, null);
  assert.equal(upgraded.reserves.canada.ore, 123); assert.deepEqual(upgraded.reserves.usa, { ore: 300, grain: 300 });
  assert.deepEqual(upgraded.players, g.players); assert.equal(upgraded.revision, g.revision); assert.equal(upgraded.branches.length, 0);
});
test('leadership is resource-backed and cannot be stolen with client-supplied identity', () => {
  const start = fixture(); const g = applyAction(start, 'a', { type: 'claim-government', country: 'brazil', leader: 'b' });
  assert.equal(g.politics.governments.canada.leader, 'a'); assert.equal(g.politics.governments.brazil.leader, null);
  assert.equal(g.players.a.goods.machines, 96); assert.equal(g.players.a.goods.provisions, 146);
  assert.throws(() => applyAction(g, 'b', { type: 'claim-government' }), /already/);
  const poor = joinGame(newGame(), 'poor', 'Poor', 'india'); assert.throws(() => applyAction(poor, 'poor', { type: 'claim-government' }), /Requires/);
  assert.equal(start.politics.governments.canada.leader, null);
});
test('elections freeze resident electorate, require explicit majority, and reject duplicate/foreign votes', () => {
  let g = applyAction(fixture(), 'a', { type: 'claim-government' }); g = applyAction(g, 'b', { type: 'nominate' });
  const id = g.politics.elections[0].id; g = joinGame(g, 'd', 'Delta', 'canada');
  assert.throws(() => applyAction(g, 'c', { type: 'vote', id }), /registered/);
  assert.throws(() => applyAction(g, 'd', { type: 'vote', id }), /registered/);
  g = applyAction(g, 'b', { type: 'vote', id }); assert.equal(g.politics.governments.canada.leader, 'a');
  assert.throws(() => applyAction(g, 'b', { type: 'vote', id }), /already/);
  g = applyAction(g, 'a', { type: 'vote', id }); assert.equal(g.politics.governments.canada.leader, 'b'); assert.equal(g.politics.elections.length, 0);
});
test('rebellions need substantial goods, compare stationed defense, and remain inactive without commands', async () => {
  let g = applyAction(fixture(), 'a', { type: 'claim-government' });
  const province = CAPITALS.canada; g = command(g, 'a', 'deploy', province, 8);
  assert.throws(() => command(g, 'b', 'rebel', province, 5), /6–50/);
  g = command(g, 'b', 'rebel', province, 6); assert.equal(g.politics.provinces[province].controller, 'canada'); assert.equal(g.politics.provinces[province].garrison, 2);
  assert.equal(g.players.b.goods.machines, 90); assert.equal(g.players.b.goods.provisions, 140);
  const before = structuredClone(g); await new Promise(r => setTimeout(r, 20)); assert.deepEqual(g, before);
  assert.throws(() => command(g, 'b', 'attack', CAPITALS.brazil, 1), /home/);
});
test('rebel capital and majority explicitly transfer leadership, preserving foreign occupations', () => {
  let g = applyAction(fixture(), 'a', { type: 'claim-government' });
  g = command(g, 'b', 'rebel', CAPITALS.canada, 6);
  const rebel = rebelFaction('b'), target = PROVINCES.find(p => p.country === 'canada' && p.neighbors.some(n => g.politics.provinces[n].controller === rebel))!;
  const other = PROVINCES.filter(p => p.country === 'canada' && p.id !== target.id && p.id !== CAPITALS.canada);
  for (const p of other.slice(0, 5)) g.politics.provinces[p.id].controller = rebel;
  const foreign = other.at(-1)!; g.politics.provinces[foreign.id].controller = 'brazil';
  g = command(g, 'b', 'attack', target.id, 1);
  assert.equal(g.politics.governments.canada.leader, 'b'); assert.equal(g.politics.governments.canada.mode, 'revolution');
  assert.equal(g.politics.rebellions.length, 0); assert.equal(g.politics.provinces[foreign.id].controller, 'brazil');
  assert.ok(Object.values(g.politics.provinces).every(p => p.controller !== rebel));
});
test('wars need two human-led countries; province battles honor garrisons, versions and entry geography', () => {
  let g = applyAction(fixture(), 'a', { type: 'claim-government' });
  assert.throws(() => applyAction(g, 'b', { type: 'declare-war', country: 'brazil' }), /leader/);
  assert.throws(() => applyAction(g, 'a', { type: 'declare-war', country: 'brazil' }), /human-governed/);
  assert.throws(() => applyAction(g, 'a', { type: 'declare-war', country: 'toString' }), /Unknown country/);
  g = applyAction(g, 'c', { type: 'claim-government' });
  const entry = PROVINCES.find(p => p.country === 'brazil' && p.entry)!, interior = PROVINCES.find(p => p.country === 'brazil' && !p.entry)!;
  assert.throws(() => command(g, 'a', 'attack', entry.id, 1), /Declare war/);
  g = applyAction(g, 'a', { type: 'declare-war', country: 'brazil' });
  assert.throws(() => command(g, 'a', 'attack', interior.id, 1), /adjacent/);
  g = command(g, 'c', 'deploy', entry.id, 3);
  const oldVersion = g.politics.provinces[entry.id].version; g = command(g, 'a', 'attack', entry.id, 3);
  assert.equal(g.politics.provinces[entry.id].controller, 'brazil'); assert.equal(g.politics.provinces[entry.id].garrison, 0);
  assert.throws(() => applyAction(g, 'a', { type: 'attack', province: entry.id, version: oldVersion, units: 1 }), /changed/);
  g = command(g, 'a', 'attack', entry.id, 2); assert.equal(g.politics.provinces[entry.id].controller, 'canada'); assert.equal(g.politics.provinces[entry.id].garrison, 2);
  const war = g.politics.wars[0]; assert.throws(() => applyAction(g, 'a', { type: 'peace', id: war.id, accept: true }));
  g = applyAction(g, 'a', { type: 'peace', id: war.id }); g = applyAction(g, 'c', { type: 'peace', id: war.id, accept: true });
  assert.equal(g.politics.wars.length, 0); assert.equal(g.politics.provinces[entry.id].controller, 'canada');
});
test('simultaneous conflicting attacks reject the stale command without extra losses', async () => {
  const store = new SqliteStore(':memory:');
  try {
    const a = await join(store, { name: 'Atlas', country: 'canada' }, undefined, 'a');
    const b = await join(store, { name: 'Boreal', country: 'brazil' }, undefined, 'b');
    await store.transaction(s => { for (const p of Object.values(s.game.players)) { p.goods.machines = 30; p.goods.provisions = 30; } });
    await act(store, a.token, { sequence: 1, action: { type: 'claim-government' } });
    await act(store, b.token, { sequence: 1, action: { type: 'claim-government' } });
    await act(store, a.token, { sequence: 2, action: { type: 'declare-war', country: 'brazil' } });
    const target = PROVINCES.find(p => p.country === 'brazil' && p.entry)!;
    const bodies = [
      act(store, a.token, { sequence: 3, action: { type: 'attack', province: target.id, version: 0, units: 1 } }),
      act(store, b.token, { sequence: 2, action: { type: 'deploy', province: target.id, version: 0, units: 1 } }),
    ];
    const results = await Promise.allSettled(bodies); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const state = await snapshot(store, a.token); assert.equal(state.game.politics.provinces[target.id].garrison, 1);
    assert.equal(state.game.players[b.playerId].goods.machines, 26); assert.equal(state.sequence, 3);
  } finally { await store.close(); }
});
test('simultaneous claimants and province commands commit once, rollback the loser and safely retry', async () => {
  const store = new SqliteStore(':memory:');
  try {
    const a = await join(store, { name: 'Atlas', country: 'canada' }, undefined, 'ip-a');
    const b = await join(store, { name: 'Boreal', country: 'canada' }, undefined, 'ip-b');
    await store.transaction(s => { for (const p of Object.values(s.game.players)) { p.goods.machines = 30; p.goods.provisions = 30; } });
    const claims = await Promise.allSettled([a, b].map(p => act(store, p.token, { sequence: 1, action: { type: 'claim-government' } })));
    assert.equal(claims.filter(r => r.status === 'fulfilled').length, 1);
    const view = await snapshot(store, a.token), leader = view.game.politics.governments.canada.leader === a.playerId ? a : b;
    const province = CAPITALS.canada; const body = { sequence: 2, action: { type: 'deploy', province, units: 2, version: view.game.politics.provinces[province].version } };
    const retries = await Promise.all([act(store, leader.token, body), act(store, leader.token, body)]);
    assert.equal(retries.filter(r => r.replayed).length, 1); assert.equal(retries[0].game.politics.provinces[province].garrison, 2);
  } finally { await store.close(); }
});
