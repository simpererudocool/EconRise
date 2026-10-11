import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { applyAction, joinGame, RuleError } from './game';
import { Envelope, Store } from './store';

export function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function sessionFor(state: Envelope, token: string | undefined) {
  const session = token && state.sessions[hash(token)];
  if (!session) throw new RuleError('Join the world to continue.', 401);
  return session;
}
export async function snapshot(store: Store, token?: string) {
  const state = await store.read();
  const session = sessionFor(state, token);
  return { game: state.game, playerId: session.playerId, sequence: session.sequence };
}
export async function join(store: Store, input: unknown, existingToken: string | undefined, admissionKey: string) {
  const token = randomBytes(32).toString('base64url');
  return store.transaction(state => {
    const existing = existingToken && state.sessions[hash(existingToken)];
    if (existing) return { token: existingToken!, game: state.game, playerId: existing.playerId, sequence: existing.sequence };
    if (!input || typeof input !== 'object') throw new RuleError('Invalid join request.');
    const body = input as Record<string, unknown>;
    const now = Date.now();
    // Security timestamps never drive economic rules or game transitions.
    state.joins = Object.fromEntries(Object.entries(state.joins).map(([key, times]) => [key, times.filter(t => now - t < 3600000)]).filter(([, times]) => times.length));
    const times = state.joins[admissionKey] || [];
    if (times.length >= 8) throw new RuleError('Too many new companies from this address. Try again in an hour.', 429);
    const id = randomUUID(); state.game = joinGame(state.game, id, body.name, body.country);
    state.sessions[hash(token)] = { playerId: id, sequence: 0, receipts: [], actions: [] };
    state.joins[admissionKey] = [...times, now];
    return { token, game: state.game, playerId: id, sequence: 0 };
  });
}
export async function act(store: Store, token: string | undefined, body: unknown) {
  if (!body || typeof body !== 'object') throw new RuleError('Invalid action envelope.');
  const { sequence, action } = body as { sequence: unknown; action: unknown };
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) throw new RuleError('Invalid action sequence.');
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new RuleError('Invalid action payload.');
  const digest = hash(JSON.stringify(action));
  return store.transaction(state => {
    const session = sessionFor(state, token);
    const receipt = session.receipts.find(r => r.sequence === sequence);
    if (receipt) {
      if (receipt.digest !== digest) throw new RuleError('Sequence already used for a different action.', 409);
      return { game: state.game, playerId: session.playerId, sequence: session.sequence, replayed: true };
    }
    if (sequence !== session.sequence + 1) throw new RuleError('Stale action sequence. Refresh state before acting.', 409);
    const now = Date.now(); const recent = session.actions.filter(t => now - t < 10000);
    if (recent.length >= 20) throw new RuleError('Action limit reached. Wait a few seconds.', 429);
    state.game = applyAction(state.game, session.playerId, action);
    session.sequence = sequence;
    session.actions = [...recent, now];
    session.receipts.push({ sequence, digest, revision: state.game.revision });
    session.receipts = session.receipts.slice(-64);
    return { game: state.game, playerId: session.playerId, sequence, replayed: false };
  });
}
