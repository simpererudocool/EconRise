import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { PostgresStore } from '../lib/store';
import { act, join, snapshot } from '../lib/service';
import { newGame } from '../lib/game';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required. Use a dedicated migrated Supabase test project, never your live world.');
if (process.env.TEST_DATABASE_RESET !== 'I_CONFIRM_THIS_IS_A_DISPOSABLE_DATABASE') throw new Error('Explicit TEST_DATABASE_RESET confirmation required. This test resets the disposable test world.');
test('real PostgreSQL: independent function instances serialize scarce fills, retry safely, and survive reconnect', async () => {
  const admin = new Pool({ connectionString, max: 1, ssl: { rejectUnauthorized: true } });
  const first = new PostgresStore(connectionString), second = new PostgresStore(connectionString);
  try {
    await admin.query('UPDATE private.econrise_world SET data=$1::jsonb WHERE id=1', [JSON.stringify({ game: newGame(), sessions: {}, joins: {} })]);
    await admin.query('UPDATE public.econrise_revisions SET revision=0 WHERE id=1');
    const a = await join(first, { name: 'Atlas', country: 'canada' }, undefined, 'test-a');
    const b = await join(first, { name: 'Boreal', country: 'brazil' }, undefined, 'test-b');
    const c = await join(second, { name: 'Cobalt', country: 'japan' }, undefined, 'test-c');
    const posted = await act(first, a.token, { sequence: 1, action: { type: 'order', side: 'sell', good: 'ore', quantity: 1, price: 20 } });
    const action = { sequence: 1, action: { type: 'fill', id: posted.game.orders[0].id, quantity: 1 } };
    const outcomes = await Promise.allSettled([act(first, b.token, action), act(second, c.token, action)]);
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(o => o.status === 'rejected').length, 1);
    const winner = outcomes[0].status === 'fulfilled' ? b : c;
    assert.equal((await act(second, winner.token, action)).replayed, true);
    const reconnected = await snapshot(second, a.token); assert.equal(reconnected.game.orders.length, 0);
    assert.equal(reconnected.game.players[a.playerId].cash, 1020);
    const notice = await admin.query('SELECT revision FROM public.econrise_revisions WHERE id=1'); assert.equal(Number(notice.rows[0].revision), reconnected.game.revision);
    const before = await snapshot(first, a.token);
    await assert.rejects(act(second, a.token, { sequence: 2, action: { type: 'produce', good: 'machines', quantity: 999 } }));
    assert.deepEqual(await snapshot(first, a.token), before);
  } finally { await first.close(); await second.close(); await admin.end(); }
});
