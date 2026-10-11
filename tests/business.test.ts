import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, COUNTRIES, Game, joinGame, newGame } from '../lib/game';
import { branchActive, CAPITALS } from '../lib/politics';
import { SqliteStore } from '../lib/store';
import { act, join, snapshot } from '../lib/service';
function setup() { return joinGame(joinGame(newGame(), 'a', 'Atlas', 'canada'), 'b', 'Boreal', 'germany'); }
function open(g: Game, owner = 'a', province = CAPITALS.france) { return applyAction(g, owner, { type: 'open-branch', province, version: g.politics.provinces[province].version }); }
test('all 24 countries admit humans with equal starting capital, stock and aggregate yields', () => {
  for (const c of COUNTRIES) {
    const g = joinGame(newGame(), 'a', 'Atlas', c.id); assert.equal(g.players.a.cash, 1000);
    assert.deepEqual(g.players.a.goods, { ore: 12, grain: 12, machines: 2, provisions: 2 }); assert.equal(c.ore + c.grain, 10);
    assert.ok(g.politics.provinces[CAPITALS[c.id]]); assert.deepEqual(g.reserves[c.id], { ore: 300, grain: 300 });
  }
});
test('ungoverned unconquered land accepts a branch without minting money or sovereignty', () => {
  const g = open(setup()); assert.equal(g.branches.length, 1); assert.equal(g.players.a.cash, 1000);
  assert.equal(g.players.a.goods.machines, 0); assert.equal(g.players.a.goods.provisions, 0);
  assert.equal(g.politics.governments.france.leader, null); assert.equal(g.politics.provinces[CAPITALS.france].controller, 'france');
  assert.equal(g.players.a.country, 'canada'); assert.ok(branchActive(g, g.branches[0]));
});
test('branch extraction uses host finite reserves and cannot spoof branch ownership', () => {
  let g = open(setup()); const branch = g.branches[0];
  g = applyAction(g, 'a', { type: 'extract', branch: branch.id, good: 'grain', quantity: 6 });
  assert.equal(g.reserves.france.grain, 294); assert.equal(g.reserves.canada.grain, 300); assert.equal(g.players.a.goods.grain, 18);
  assert.throws(() => applyAction(g, 'b', { type: 'extract', branch: branch.id, good: 'grain', quantity: 1 }), /own/);
  assert.throws(() => applyAction(g, 'a', { type: 'extract', branch: branch.id, good: 'ore', quantity: 6 }), /1 to 4/);
  const before = structuredClone(g); g.politics.provinces[branch.province].controller = 'germany';
  assert.ok(!branchActive(g, branch)); assert.throws(() => applyAction(g, 'a', { type: 'extract', branch: branch.id, good: 'grain', quantity: 1 }), /suspended/);
  assert.equal(g.players.a.cash, before.players.a.cash); assert.equal(g.branches.length, 1);
});
test('war, rebellion, occupation, duplicate slots and stale site versions reject branch opening atomically', () => {
  const g = setup(), province = CAPITALS.france;
  for (const variant of ['war', 'rebellion', 'occupation']) {
    const blocked = structuredClone(g);
    if (variant === 'war') blocked.politics.wars.push({ id: 'w', a: 'france', b: 'germany' });
    else if (variant === 'rebellion') blocked.politics.rebellions.push({ id: 'r', country: 'france', player: 'b' });
    else blocked.politics.provinces[province].controller = 'germany';
    const before = structuredClone(blocked); assert.throws(() => open(blocked), /peaceful/); assert.deepEqual(blocked, before);
  }
  const opened = open(g); assert.throws(() => open(opened, 'b'), /already/);
  assert.throws(() => applyAction(opened, 'b', { type: 'open-branch', province, version: 0 }), /changed/);
});
test('branch owners alone can close branches; closing releases the site without resource refunds', () => {
  let g = open(setup()); const id = g.branches[0].id;
  assert.throws(() => applyAction(g, 'b', { type: 'close-branch', id }), /owner/);
  g = applyAction(g, 'a', { type: 'close-branch', id }); assert.equal(g.branches.length, 0); assert.equal(g.players.a.goods.machines, 0);
  g = open(g, 'b'); assert.equal(g.branches[0].owner, 'b');
});
test('an active foreign branch gives human freight access without changing citizenship', () => {
  let g = open(setup());
  g = applyAction(g, 'b', { type: 'shipment', destination: 'france', good: 'ore', quantity: 1, reward: 10 });
  // Explicit manufactured-stock fixture supplies the freight provision.
  g.players.a.goods.provisions = 1;
  g = applyAction(g, 'a', { type: 'deliver', id: g.shipments[0].id });
  assert.equal(g.players.a.cash, 1010); assert.equal(g.players.a.country, 'canada'); assert.equal(g.players.a.delivered, 1);
});
test('branch cap and goods costs cannot be bypassed', () => {
  const g = setup(); g.players.a.goods.machines = 20; g.players.a.goods.provisions = 20;
  let current = g;
  for (const c of COUNTRIES.slice(0, 6)) current = open(current, 'a', CAPITALS[c.id]);
  assert.throws(() => open(current, 'a', CAPITALS.japan), /six/);
  const poor = setup(); poor.players.a.goods.provisions = 1; const before = structuredClone(poor);
  assert.throws(() => open(poor), /provisions/); assert.deepEqual(poor, before);
});
test('two humans racing to open the same site commit exactly one branch and preserve the losers goods', async () => {
  const store = new SqliteStore(':memory:');
  try {
    const a = await join(store, { name: 'Atlas', country: 'canada' }, undefined, 'a');
    const b = await join(store, { name: 'Boreal', country: 'germany' }, undefined, 'b');
    const body = { sequence: 1, action: { type: 'open-branch', province: CAPITALS.france, version: 0 } };
    const results = await Promise.allSettled([act(store, a.token, body), act(store, b.token, body)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    const state = await snapshot(store, a.token); assert.equal(state.game.branches.length, 1);
    assert.equal(Object.values(state.game.players).reduce((s, p) => s + p.goods.machines, 0), 2);
    const winner = state.game.branches[0].owner === a.playerId ? a : b;
    assert.equal((await act(store, winner.token, body)).replayed, true);
  } finally { await store.close(); }
});
