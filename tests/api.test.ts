import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/game/route';

process.env.SQLITE_PATH = ':memory:';
const origin = 'http://localhost:3000';
function post(body: unknown, cookie?: string, overrides: Record<string, string> = {}) {
  return POST(new NextRequest(`${origin}/api/game`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...overrides }, body: JSON.stringify(body) }));
}
test('HTTP route: origin checks, auth, bounded input, cookie sessions, recovery and anti-cheat', async () => {
  assert.equal((await GET(new NextRequest(`${origin}/api/game`))).status, 401);
  // Next dev may normalize req.url to localhost while retaining 127.0.0.1 Host.
  const loopback = await post({ operation: 'join', name: 'Loopback', country: 'japan' }, undefined, { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000' });
  assert.equal(loopback.status, 200);
  assert.equal((await post({ operation: 'join', name: 'Web Atlas', country: 'canada' }, undefined, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ operation: 'join', name: 'Web Atlas', country: 'canada', manual: true })).status, 403);
  assert.equal((await post({ padding: 'x'.repeat(5000) })).status, 413);
  const malformed = await POST(new NextRequest(`${origin}/api/game`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{broken' }));
  assert.equal(malformed.status, 400);
  const joined = await post({ operation: 'join', name: 'Web Atlas', country: 'canada' }); assert.equal(joined.status, 200);
  const setCookie = joined.headers.get('set-cookie')!; assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=strict/i);
  const cookie = setCookie.split(';')[0], initial = await joined.json(); assert.equal(initial.token, undefined);
  const restored = await post({ operation: 'restore', recoveryKey: initial.recoveryKey }); assert.equal(restored.status, 200);
  assert.equal((await restored.json()).playerId, initial.playerId);
  const success = await post({ operation: 'act', sequence: 1, action: { type: 'extract', good: 'ore', quantity: 6, cash: 9000000 } }, cookie);
  assert.equal(success.status, 200); assert.equal((await success.json()).game.players[initial.playerId].cash, 1000);
  const reconnect = await GET(new NextRequest(`${origin}/api/game`, { headers: { Cookie: cookie } })); assert.equal(reconnect.status, 200);
  const state = await reconnect.json(); assert.equal(state.sequence, 1); assert.equal(state.game.players[initial.playerId].goods.ore, 18);
  assert.equal((await post({ operation: 'act', sequence: 2, action: { type: 'order', side: 'sell', good: 'ore', quantity: 999, price: 1 } }, cookie)).status, 400);
});
