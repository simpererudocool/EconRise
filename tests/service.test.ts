import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { SqliteStore } from '../lib/store';
import { act, join, snapshot } from '../lib/service';

async function fixture() {
  const store = new SqliteStore(':memory:');
  const a = await join(store, { name: 'Atlas', country: 'canada' }, undefined, 'ip-a');
  const b = await join(store, { name: 'Boreal', country: 'brazil' }, undefined, 'ip-b');
  const c = await join(store, { name: 'Cobalt', country: 'japan' }, undefined, 'ip-c');
  return { store, a, b, c };
}
test('two simultaneous human buyers cannot both acquire the same scarce resource', async () => {
  const { store, a, b, c } = await fixture();
  try {
    const posted = await act(store, a.token, { sequence: 1, action: { type: 'order', side: 'sell', good: 'ore', quantity: 1, price: 30 } });
    const orderId = posted.game.orders[0].id;
    const results = await Promise.allSettled([b, c].map(p => act(store, p.token, { sequence: 1, action: { type: 'fill', id: orderId, quantity: 1 } })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    const state = await snapshot(store, a.token); assert.equal(state.game.orders.length, 0); assert.equal(state.game.players[a.playerId].cash, 1030);
    assert.equal(Object.values(state.game.players).reduce((n, p) => n + p.cash, 0), 3000);
    assert.equal(state.game.players[b.playerId].goods.ore + state.game.players[c.playerId].goods.ore, 25);
    assert.equal(state.game.revision, posted.game.revision + 1);
  } finally { await store.close(); }
});
test('retry after a disconnect commits an action exactly once, including concurrent retries', async () => {
  const { store, a } = await fixture();
  try {
    const body = { sequence: 1, action: { type: 'extract', good: 'ore', quantity: 6 } };
    await act(store, a.token, body); // response deliberately lost; reconnect is a new read
    const reconnected = await snapshot(store, a.token); assert.equal(reconnected.sequence, 1);
    const retries = await Promise.all([act(store, a.token, body), act(store, a.token, body)]);
    assert.ok(retries.every(r => r.replayed)); assert.equal(retries[0].game.players[a.playerId].goods.ore, 18);
    await assert.rejects(act(store, a.token, { sequence: 1, action: { type: 'extract', good: 'grain', quantity: 1 } }), /different action/);
    await assert.rejects(act(store, a.token, { sequence: 3, action: body.action }), /Stale/);
  } finally { await store.close(); }
});
test('disconnect and process restart retain the same company, inventory, sequence and open orders', async () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'econrise-')); const path = pathJoin(dir, 'world.sqlite');
  let store = new SqliteStore(path);
  try {
    const a = await join(store, { name: 'Atlas', country: 'canada' }, undefined, 'ip');
    await act(store, a.token, { sequence: 1, action: { type: 'order', side: 'sell', good: 'ore', quantity: 2, price: 40 } });
    const before = await snapshot(store, a.token); await store.close(); store = new SqliteStore(path);
    const after = await snapshot(store, a.token); assert.deepEqual(after, before);
    const resume = await join(store, { name: 'Ignored', country: 'japan' }, a.token, 'ip'); assert.equal(resume.playerId, a.playerId); assert.equal(Object.keys(resume.game.players).length, 1);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('invalid trades rollback without consuming action sequence, escrow or revisions', async () => {
  const { store, a } = await fixture();
  try {
    const before = await snapshot(store, a.token);
    await assert.rejects(act(store, a.token, { sequence: 1, action: { type: 'order', side: 'sell', good: 'ore', quantity: 500, price: 1 } }));
    assert.deepEqual(await snapshot(store, a.token), before);
  } finally { await store.close(); }
});
test('session secrets are hashed at rest and snapshots never expose credentials', async () => {
  const { store, a, b } = await fixture();
  try {
    const raw = await store.read(); assert.ok(!JSON.stringify(raw).includes(a.token));
    const view = await snapshot(store, a.token); assert.ok(!('sessions' in view)); assert.ok(!('sessions' in view.game));
    await assert.rejects(snapshot(store, undefined), /Join/); await assert.rejects(snapshot(store, 'forged'), /Join/);
    const r = await act(store, a.token, { sequence: 1, action: { type: 'extract', good: 'grain', quantity: 4, playerId: b.playerId } });
    assert.equal(r.game.players[b.playerId].goods.grain, 12); assert.equal(r.game.players[a.playerId].goods.grain, 16);
  } finally { await store.close(); }
});
test('unknown caller-provided tokens cannot fixate a new company session', async () => {
  const store = new SqliteStore(':memory:');
  try {
    const result = await join(store, { name: 'Fresh', country: 'india' }, 'attacker-chosen-token', 'ip');
    assert.notEqual(result.token, 'attacker-chosen-token');
    await assert.rejects(snapshot(store, 'attacker-chosen-token'));
    await assert.rejects(act(store, result.token, { sequence: 1 }), /Invalid action payload/);
  } finally { await store.close(); }
});
test('two simultaneous lenders fund a request once', async () => {
  const { store, a, b, c } = await fixture();
  try {
    const request = await act(store, a.token, { sequence: 1, action: { type: 'request-loan', principal: 100, interest: 10, good: 'ore', collateral: 2 } });
    const results = await Promise.allSettled([b, c].map(p => act(store, p.token, { sequence: 1, action: { type: 'fund-loan', id: request.game.loans[0].id } })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const state = await snapshot(store, a.token); assert.equal(state.game.players[a.playerId].cash, 1100);
    assert.equal(Object.values(state.game.players).reduce((n, p) => n + p.cash, 0), 3000);
  } finally { await store.close(); }
});
test('security rate limits bound manual action spam without introducing economic ticks', async () => {
  const { store, a } = await fixture();
  try {
    for (let sequence = 1; sequence <= 20; sequence++) await act(store, a.token, { sequence, action: { type: 'extract', good: 'grain', quantity: 1 } });
    await assert.rejects(act(store, a.token, { sequence: 21, action: { type: 'extract', good: 'grain', quantity: 1 } }), /Action limit/);
    assert.equal((await snapshot(store, a.token)).sequence, 20);
  } finally { await store.close(); }
});
test('admission limit prevents unlimited starting credit grants from one address', async () => {
  const store = new SqliteStore(':memory:');
  try {
    for (let i = 0; i < 8; i++) await join(store, { name: `Company ${i}`, country: 'canada' }, undefined, 'same-ip');
    await assert.rejects(join(store, { name: 'Ninth', country: 'canada' }, undefined, 'same-ip'), /Too many/);
  } finally { await store.close(); }
});
