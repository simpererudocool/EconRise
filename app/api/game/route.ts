import { NextRequest, NextResponse } from 'next/server';
import { RuleError } from '@/lib/game';
import { act, hash, join, snapshot } from '@/lib/service';
import { getStore } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const COOKIE = 'econrise_session';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function manual() { return !process.env.VERCEL && process.env.ECONRISE_MANUAL_TEST === '1'; }
function token(req: NextRequest) {
  if (manual() && req.headers.get('authorization')?.startsWith('Bearer ')) return req.headers.get('authorization')!.slice(7);
  return req.cookies.get(COOKIE)?.value;
}
function fail(error: unknown) {
  if (error instanceof RuleError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  console.error('EconRise request failed:', error instanceof Error ? error.message : 'unknown error');
  return NextResponse.json({ error: 'The world is temporarily unavailable. Please retry; do not submit a new action until state reconnects.' }, { status: 503, headers });
}
export async function GET(req: NextRequest) {
  try { return NextResponse.json(await snapshot(getStore(), token(req)), { headers }); }
  catch (error) { return fail(error); }
}
export async function POST(req: NextRequest) {
  try {
    // Next's development server can normalize req.url to localhost even when
    // the browser uses 127.0.0.1. Host is used only locally; production requires
    // the explicit trusted APP_ORIGIN below.
    const requestUrl = new URL(req.url);
    const origin = process.env.APP_ORIGIN || `${requestUrl.protocol}//${req.headers.get('host') || requestUrl.host}`;
    if (process.env.VERCEL && !process.env.APP_ORIGIN) throw new Error('APP_ORIGIN must be set to this Vercel deployment origin.');
    if (req.headers.get('origin') !== origin) throw new RuleError('Cross-origin mutations are forbidden.', 403);
    if (!req.headers.get('content-type')?.startsWith('application/json')) throw new RuleError('Use application/json.', 415);
    if (Number(req.headers.get('content-length') || 0) > 4096) throw new RuleError('Request too large.', 413);
    const reader = req.body?.getReader();
    if (!reader) throw new RuleError('Missing request body.');
    let total = 0; const chunks: Uint8Array[] = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 4096) { await reader.cancel(); throw new RuleError('Request too large.', 413); } chunks.push(value); }
    let body: Record<string, unknown>;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RuleError('Malformed JSON.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RuleError('Invalid request.');
    const store = getStore();
    if (body.operation === 'join') {
      if (body.manual && !manual()) throw new RuleError('Manual test mode is disabled.', 403);
      const ip = process.env.VERCEL ? req.headers.get('x-vercel-forwarded-for') || req.headers.get('x-forwarded-for') || 'unknown' : 'local';
      const result = await join(store, body, body.manual ? undefined : token(req), hash(ip));
      const { token: secret, ...publicResult } = result;
      const response = NextResponse.json({ ...publicResult, recoveryKey: secret, ...(body.manual ? { token: secret } : {}) }, { headers });
      if (!body.manual) response.cookies.set(COOKIE, secret, { httpOnly: true, secure: new URL(req.url).protocol === 'https:', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 30 });
      return response;
    }
    if (body.operation === 'restore') {
      if (typeof body.recoveryKey !== 'string' || !/^[\w-]{43}$/.test(body.recoveryKey)) throw new RuleError('Invalid recovery key.');
      const result = await snapshot(store, body.recoveryKey);
      const response = NextResponse.json(result, { headers });
      response.cookies.set(COOKIE, body.recoveryKey, { httpOnly: true, secure: new URL(req.url).protocol === 'https:', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 30 });
      return response;
    }
    if (body.operation !== 'act') throw new RuleError('Unknown operation.');
    return NextResponse.json(await act(store, token(req), body), { headers });
  } catch (error) { return fail(error); }
}
