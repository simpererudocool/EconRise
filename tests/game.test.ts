import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, Game, Good, GOODS, COUNTRIES, joinGame, newGame, capital } from '../lib/game';
function world() { return joinGame(joinGame(newGame(), 'a', 'Atlas', 'canada'), 'b', 'Boreal', 'brazil'); }
function credits(g: Game) {
  return Object.values(g.players).reduce((s, p) => s + p.cash, 0)
    + g.orders.filter(o => o.side === 'buy').reduce((s, o) => s + o.price * o.quantity, 0)
    + g.shipments.reduce((s, o) => s + o.reward, 0);
}
function goods(g: Game, resource: Good) {
  return Object.values(g.players).reduce((s, p) => s + p.goods[resource], 0)
    + g.orders.filter(o => o.side === 'sell' && o.good === resource).reduce((s, o) => s + o.quantity, 0)
    + g.loans.filter(o => o.good === resource).reduce((s, o) => s + o.collateral, 0)
    + g.shipments.filter(o => o.good === resource).reduce((s, o) => s + o.quantity, 0);
}
test('invalid actions never change the source state', () => {
  const g = world(), original = structuredClone(g);
  for (const action of [
    { type: 'order', side: 'sell', good: 'ore', quantity: 999, price: 1 },
    { type: 'order', side: 'buy', good: 'ore', quantity: 100, price: 100 },
    { type: 'order', side: 'buy', good: 'cash', quantity: 1, price: 1 },
    { type: 'order', side: 'sell', good: 'ore', quantity: -1, price: 1 },
    { type: 'order', side: 'sell', good: 'ore', quantity: 1, price: 1.5 },
    { type: 'produce', good: 'machines', quantity: 20 },
    { type: 'extract', good: 'ore', quantity: Infinity },
    { type: 'fill', id: 'missing', quantity: 1 },
    { type: 'create-money', amount: 1000 }, null,
  ]) { assert.throws(() => applyAction(g, 'a', action)); assert.deepEqual(g, original); }
  assert.throws(() => applyAction(g, 'intruder', { type: 'build' }));
});
test('sell orders escrow goods; partial fills and cancellation conserve all money and goods', () => {
  let g = world(); const before = GOODS.map(r => goods(g, r));
  g = applyAction(g, 'a', { type: 'order', side: 'sell', good: 'ore', quantity: 3, price: 25 });
  const id = g.orders[0].id; assert.equal(g.players.a.goods.ore, 9); assert.equal(g.prices.ore, undefined);
  assert.throws(() => applyAction(g, 'a', { type: 'fill', id, quantity: 1 }), /yourself/);
  assert.throws(() => applyAction(g, 'b', { type: 'cancel', id }), /owner/);
  assert.throws(() => applyAction(g, 'b', { type: 'fill', id, quantity: 4 }), /remaining/);
  g = applyAction(g, 'b', { type: 'fill', id, quantity: 2 });
  assert.equal(g.prices.ore, 25); assert.equal(g.players.b.cash, 950); assert.equal(g.players.a.cash, 1050);
  g = applyAction(g, 'a', { type: 'cancel', id }); assert.equal(g.orders.length, 0);
  assert.equal(credits(g), 2000); assert.deepEqual(GOODS.map(r => goods(g, r)), before);
});
test('buy orders escrow credits and cannot be funded with local client balances', () => {
  let g = world(); g = applyAction(g, 'a', { type: 'order', side: 'buy', good: 'grain', quantity: 4, price: 10, cash: 999999 });
  assert.equal(g.players.a.cash, 960); assert.equal(capital(g, g.players.a), 1000);
  const id = g.orders[0].id; g = applyAction(g, 'b', { type: 'fill', id, quantity: 1 });
  g = applyAction(g, 'a', { type: 'cancel', id });
  assert.equal(g.players.a.cash, 990); assert.equal(g.players.b.cash, 1010); assert.equal(credits(g), 2000);
});
test('only explicit extraction uses finite country reserves; production consumes recipe inputs', () => {
  let g = world(); const before = g.reserves.canada.ore;
  g = applyAction(g, 'a', { type: 'extract', good: 'ore', quantity: 6 }); assert.equal(g.reserves.canada.ore, before - 6);
  assert.throws(() => applyAction(g, 'a', { type: 'extract', good: 'ore', quantity: 7 }));
  g = applyAction(g, 'a', { type: 'produce', good: 'machines', quantity: 2 });
  assert.equal(g.players.a.goods.ore, 14); assert.equal(g.players.a.goods.grain, 10); assert.equal(g.players.a.goods.machines, 4);
  g = applyAction(g, 'a', { type: 'build' }); assert.equal(g.players.a.facilities, 1); assert.equal(g.players.a.goods.machines, 0);
  assert.equal(credits(g), 2000);
  g.reserves.canada.ore = 1; assert.throws(() => applyAction(g, 'a', { type: 'extract', good: 'ore', quantity: 2 }), /exhausted/);
});
test('loans require a human lender, conserve money, and lock collateral until voluntary repayment', () => {
  let g = world(); const before = goods(g, 'ore');
  g = applyAction(g, 'a', { type: 'request-loan', principal: 100, interest: 10, good: 'ore', collateral: 5 });
  const id = g.loans[0].id; assert.equal(g.players.a.cash, 1000); assert.equal(g.players.a.goods.ore, 7);
  assert.throws(() => applyAction(g, 'a', { type: 'fund-loan', id }));
  g = applyAction(g, 'b', { type: 'fund-loan', id }); assert.equal(g.players.a.cash, 1100);
  assert.throws(() => applyAction(g, 'b', { type: 'fund-loan', id }));
  assert.throws(() => applyAction(g, 'b', { type: 'close-loan', id }));
  g = applyAction(g, 'a', { type: 'close-loan', id }); assert.equal(g.players.a.cash, 990); assert.equal(g.players.b.cash, 1010);
  assert.equal(credits(g), 2000); assert.equal(goods(g, 'ore'), before); assert.equal(g.loans.length, 0);
});
test('borrowers can surrender agreed collateral, never auto-default', () => {
  let g = applyAction(world(), 'a', { type: 'request-loan', principal: 100, interest: 10, good: 'grain', collateral: 4 });
  const id = g.loans[0].id; g = applyAction(g, 'b', { type: 'fund-loan', id }); g = applyAction(g, 'a', { type: 'close-loan', id, surrender: true });
  assert.equal(g.players.b.goods.grain, 16); assert.equal(credits(g), 2000); assert.equal(g.loans.length, 0);
});
test('freight needs another human in destination and consumes one provision only when delivered', () => {
  let g = applyAction(world(), 'a', { type: 'shipment', good: 'ore', quantity: 3, reward: 20, destination: 'brazil' });
  const id = g.shipments[0].id;
  assert.throws(() => applyAction(g, 'a', { type: 'deliver', id }));
  g = joinGame(g, 'c', 'Cobalt', 'japan'); assert.throws(() => applyAction(g, 'c', { type: 'deliver', id }), /destination/);
  g = applyAction(g, 'b', { type: 'deliver', id }); assert.equal(g.players.b.goods.ore, 15); assert.equal(g.players.b.goods.provisions, 1);
  assert.equal(g.players.b.cash, 1020); assert.equal(g.players.b.delivered, 1); assert.equal(credits(g), 3000);
});
test('alliances are mutual and never generate wealth', () => {
  let g = applyAction(world(), 'a', { type: 'invite', target: 'b' }); const id = g.alliances[0].id;
  assert.throws(() => applyAction(g, 'a', { type: 'alliance', id, accept: true }));
  g = applyAction(g, 'b', { type: 'alliance', id, accept: true }); assert.equal(g.alliances[0].accepted, true); assert.equal(credits(g), 2000);
});
test('countries have equal aggregate yields and identical initial endowments', () => {
  const g = world(); assert.deepEqual(g.players.a.goods, g.players.b.goods); assert.equal(g.players.a.cash, g.players.b.cash);
  for (const c of COUNTRIES) assert.equal(c.ore + c.grain, 10);
});
test('waiting without actions never changes the economy', async () => {
  const g = world(), before = structuredClone(g); await new Promise(resolve => setTimeout(resolve, 40)); assert.deepEqual(g, before);
});
