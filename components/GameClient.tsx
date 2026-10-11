'use client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { COUNTRIES, CountryId, Game, Good, GOODS, capital } from '@/lib/game';
import WorldMap from './WorldMap';
import GovernmentPanel from './GovernmentPanel';
import BusinessPanel from './BusinessPanel';
import { branchActive, CAPITALS, PROVINCE_BY_ID } from '@/lib/politics';

type Snapshot = { game: Game; playerId: string; sequence: number; token?: string; recoveryKey?: string };
type Pending = { operation: 'act'; sequence: number; action: Record<string, unknown> };
type Tab = 'Market' | 'Industry' | 'Logistics' | 'Finance' | 'Diplomacy' | 'Government' | 'Business';
const icons: Record<Good, string> = { ore: '◆', grain: '✦', machines: '⚙', provisions: '◈' };
const names: Record<Good, string> = { ore: 'Ore', grain: 'Grain', machines: 'Machines', provisions: 'Provisions' };
const fmt = (n: number) => n.toLocaleString('en-US');
class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function request(method: 'GET' | 'POST', body?: unknown, token?: string): Promise<Snapshot> {
  const response = await fetch('/api/game', { method, cache: 'no-store', credentials: 'same-origin',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000) });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error || 'Request failed.', response.status);
  return result as Snapshot;
}
function ResourceSelect({ name = 'good', producedOnly = false }: { name?: string; producedOnly?: boolean }) {
  return <select name={name} aria-label="Resource">{(producedOnly ? ['machines', 'provisions'] as Good[] : GOODS).map(g => <option key={g} value={g}>{names[g]}</option>)}</select>;
}
function NumberInput({ name, label, value, max = 10000, min = 1 }: { name: string; label: string; value: number; max?: number; min?: number }) {
  return <label className="field">{label}<input type="number" name={name} defaultValue={value} min={min} max={max} required step="1" /></label>;
}
function values(event: FormEvent<HTMLFormElement>): Record<string, unknown> {
  event.preventDefault(); const data = new FormData(event.currentTarget); const output: Record<string, unknown> = {};
  for (const [key, value] of data) output[key] = ['quantity', 'price', 'principal', 'interest', 'collateral', 'reward'].includes(key) ? Number(value) : value;
  return output;
}
export default function GameClient({ manualEnabled }: { manualEnabled: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const current = useRef<Snapshot | undefined>(undefined);
  const [country, setCountry] = useState<CountryId>('canada');
  const [provinceId, setProvinceId] = useState(CAPITALS.canada);
  const selectCountry = (id: CountryId) => { setCountry(id); setProvinceId(CAPITALS[id]); };
  const selectProvince = (id: string) => { setProvinceId(id); setCountry(PROVINCE_BY_ID[id].country); };
  const [tab, setTab] = useState<Tab>('Market');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'offline' | 'guest'>('connecting');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false); const locked = useRef(false);
  const [manual, setManual] = useState(false); const manualToken = useRef<string | undefined>(undefined);
  const [pending, setPending] = useState<Pending>();
  const [recovery, setRecovery] = useState('');
  const [rank, setRank] = useState<'capital' | 'production' | 'trade' | 'logistics'>('capital');
  const accept = useCallback((result: Snapshot) => {
    if (!current.current || result.game.revision >= current.current.game.revision) {
      current.current = result; setSnapshot(result);
    }
    setStatus('connected');
  }, []);
  const refresh = useCallback(async () => {
    try { accept(await request('GET', undefined, manualToken.current)); }
    catch (err) {
      if (err instanceof ApiError && err.status === 401) { setStatus('guest'); current.current = undefined; setSnapshot(undefined); }
      else setStatus('offline');
    }
  }, [accept]);
  useEffect(() => {
    const isManual = manualEnabled && new URLSearchParams(location.search).get('manual') === '1';
    setManual(isManual);
    if (isManual) manualToken.current = sessionStorage.getItem('econrise.manual.token') || undefined;
    const saved = sessionStorage.getItem(isManual ? 'econrise.manual.pending' : 'econrise.pending');
    if (saved) { try { setPending(JSON.parse(saved)); } catch { sessionStorage.removeItem(isManual ? 'econrise.manual.pending' : 'econrise.pending'); } }
    if (isManual && !manualToken.current) setStatus('guest'); else void refresh();
    const interval = setInterval(() => { if (!document.hidden && (!isManual || manualToken.current)) void refresh(); }, 2500);
    const onFocus = () => { if (!isManual || manualToken.current) void refresh(); };
    window.addEventListener('online', onFocus); window.addEventListener('focus', onFocus);
    return () => { clearInterval(interval); window.removeEventListener('online', onFocus); window.removeEventListener('focus', onFocus); };
  }, [manualEnabled, refresh]);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || !snapshot?.playerId) return;
    let disposed = false; let cleanup: (() => void) | undefined;
    void import('@supabase/supabase-js').then(({ createClient }) => {
      if (disposed) return;
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const channel = client.channel('econrise-revisions').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'econrise_revisions' }, () => { void refresh(); }).subscribe();
      cleanup = () => { void client.removeChannel(channel); };
    }).catch(() => { /* HTTP polling remains an explicit recovery channel. */ });
    return () => { disposed = true; cleanup?.(); };
  }, [snapshot?.playerId, refresh]);
  const savePending = (value?: Pending) => {
    setPending(value); const key = manual ? 'econrise.manual.pending' : 'econrise.pending';
    if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key);
  };
  const send = async (envelope: Pending) => {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    try { const result = await request('POST', envelope, manualToken.current); accept(result); savePending(undefined); setNotice('Action committed to the shared world.'); }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Connection lost.');
      if (err instanceof ApiError && err.status < 500) { savePending(undefined); await refresh(); }
      else { setStatus('offline'); setError('Connection interrupted. Your action may have committed. Reconnect and retry the same action safely below.'); }
    } finally { locked.current = false; setBusy(false); }
  };
  const action = (a: Record<string, unknown>) => {
    if (!current.current || pending || locked.current) return;
    const envelope: Pending = { operation: 'act', sequence: current.current.sequence + 1, action: a }; savePending(envelope); void send(envelope);
  };
  const joinWorld = async (event: FormEvent<HTMLFormElement>) => {
    const data = values(event); if (locked.current) return; locked.current = true; setBusy(true); setError('');
    try {
      const result = await request('POST', { operation: 'join', ...data, country, manual });
      if (result.token) { manualToken.current = result.token; sessionStorage.setItem('econrise.manual.token', result.token); }
      setRecovery(result.recoveryKey || ''); accept(result); savePending(undefined);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not join.'); } finally { locked.current = false; setBusy(false); }
  };
  const restore = async (event: FormEvent<HTMLFormElement>) => {
    const data = values(event); setBusy(true); setError('');
    try { accept(await request('POST', { operation: 'restore', ...data })); savePending(undefined); }
    catch (err) { setError(err instanceof Error ? err.message : 'Recovery failed.'); } finally { setBusy(false); }
  };
  const game = snapshot?.game; const me = game && game.players[snapshot.playerId];
  const selected = COUNTRIES.find(c => c.id === country)!;
  const disabled = busy || !!pending || status !== 'connected';
  const playerName = (id: string) => game?.players[id]?.name || 'Unknown company';
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="/" aria-label="EconRise home"><span className="brand-mark">↗</span> ECON<span>RISE</span><small>PLAYER-DRIVEN WORLD</small></a>
      <div className="header-right"><span className={`connection ${status}`}><i className="live-dot"/>{status === 'connected' ? 'World connected' : status === 'guest' ? 'Ready to explore' : status === 'offline' ? 'Reconnecting…' : 'Connecting…'}</span>{me && <span className="avatar" title={me.name}>{me.name.slice(0, 2).toUpperCase()}</span>}</div>
    </header>
    {manual && <div className="test-banner">MANUAL TEST WORLD · Each tab is a separate human-controlled player. No automated actors.</div>}
    <main>
      <div className="page-heading"><div><div className="eyebrow">GLOBAL ECONOMIC SANDBOX</div><h1>{me ? `Your next move, ${me.name}.` : 'A world of opportunity.'}</h1><p>{me ? 'Build your advantage. Every deal starts with a player.' : 'Choose your home. Build an industry. Make your own market.'}</p></div><div className="world-badge"><span className="live-dot"/>{game ? `${Object.keys(game.players).length} companies` : '100% player-powered'}<small>{game ? `WORLD REVISION ${game.revision}` : 'NO BOTS. NO SCRIPTED TRADERS.'}</small></div></div>
      {error && <div className="alert error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      {notice && <div className="alert success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notification">×</button></div>}
      {pending && <div className="alert"><span>Unconfirmed action #{pending.sequence}. Retrying it cannot execute it twice.</span><button className="button" disabled={busy} onClick={() => void send(pending)}>Retry safely</button></div>}
      {recovery && <div className="recovery"><strong>Save your private recovery key.</strong><p>It controls your company. Keep it secret; it will not be shown again after you close this notice.</p><code>{recovery}</code><button onClick={() => setRecovery('')}>I saved it</button></div>}
      {me && game && <section className="stats-grid" aria-label="Company dashboard">
        <div className="stat"><span>AVAILABLE CREDITS</span><strong>{fmt(me.cash)} <small>cr</small></strong><p>Net financial capital {fmt(capital(game, me))} cr</p></div>
        <div className="stat"><span>INDUSTRIAL OUTPUT</span><strong>{fmt(me.produced)} <small>units</small></strong><p>{me.facilities} workshops · {2 + me.facilities} batch capacity</p></div>
        <div className="stat"><span>TRADE VOLUME</span><strong>{fmt(me.traded)} <small>cr</small></strong><p>Only completed human-to-human trades</p></div>
        <div className="stat"><span>YOUR STOCKPILE</span><div className="stock-inline">{GOODS.map(g => <span key={g} title={names[g]}><i className={`good ${g}`}>{icons[g]}</i>{me.goods[g]}</span>)}</div><p>Available assets · excludes escrow</p></div>
      </section>}
      <section className="world-layout"><div className="panel world-panel"><div className="panel-heading"><div><span className="eyebrow">THE PLAYING FIELD</span><h2>Explore the world</h2></div><span className="tag">LIVE & SHARED</span></div><WorldMap selected={country} onSelect={selectCountry} game={game} provinceId={provinceId} onProvince={selectProvince}/></div>
        <aside className="panel country-card"><div className="eyebrow">{me ? 'REGION INTELLIGENCE' : 'ESTABLISH YOUR COMPANY'}</div><div className="country-symbol" style={{ color: selected.color }}>◎</div><h2>{selected.name}</h2><p className="muted">{selected.region} · {me?.country === country ? 'Your home region' : 'Open to all players'}</p>
          <div className="country-yields"><div><i className="good ore">◆</i><span>Ore per action</span><strong>{selected.ore}</strong></div><div><i className="good grain">✦</i><span>Grain per action</span><strong>{selected.grain}</strong></div></div>
          {game ? <><div className="reserve-label">FINITE SHARED RESERVES</div><div className="reserve-row"><span>Ore</span><strong>{game.reserves[country].ore}</strong></div><div className="reserve-row"><span>Grain</span><strong>{game.reserves[country].grain}</strong></div><p className="hint">Leader: {game.players[game.politics.governments[country].leader || '']?.name || 'Ungoverned'}<br/>{Object.values(game.players).filter(p => p.country === country).map(p => p.name).join(' · ') || 'No companies here yet.'}</p></> : <p className="hint">Each region has 300 ore and 300 grain. Same starting capital; different extraction strengths.</p>}
          {!me && <form onSubmit={joinWorld} className="join-form"><label className="field">Company name<input name="name" placeholder="e.g. Meridian Trading" minLength={2} maxLength={24} required autoComplete="off" /></label><button className="button primary" disabled={busy || status === 'connecting'}>{busy ? 'Establishing…' : `Start in ${selected.name} ↗`}</button><small>1,000 credits · 12 ore · 12 grain · 2 machines · 2 provisions</small></form>}
          {me && country !== me.country && <button className="button subtle" onClick={() => selectCountry(me.country)}>Return to home region</button>}
        </aside>
      </section>
      {!me && <><section className="intro-grid"><article><span>01 / INDUSTRY</span><h3>Make something valuable.</h3><p>Extract finite resources and manufacture goods. Production happens only when you act.</p></article><article><span>02 / MARKETS</span><h3>Your price. Their decision.</h3><p>Post bids and asks. Every trade requires another player to accept your terms.</p></article><article><span>03 / COLLABORATION</span><h3>Build a network, not a script.</h3><p>Negotiate loans, offer freight contracts, and form alliances across the map.</p></article></section><section className="panel restore-panel"><details><summary>Already have a company? Restore with your recovery key</summary><form onSubmit={restore}><input name="recoveryKey" aria-label="Private recovery key" placeholder="Private recovery key" required autoComplete="off" type="password"/><button className="button" disabled={busy}>Restore company</button></form></details>{manualEnabled && !manual && <a href="/?manual=1" target="_blank" rel="noreferrer">Open a separate manual-test player ↗</a>}</section></>}
      {me && game && <section className="workspace-grid"><div className="panel economy-panel"><nav className="tabs" aria-label="Economic activities">{(['Market', 'Industry', 'Business', 'Logistics', 'Finance', 'Diplomacy', 'Government'] as Tab[]).map(t => <button key={t} onClick={() => setTab(t)} className={tab === t ? 'active' : ''} aria-pressed={tab === t}>{t}</button>)}</nav>
        {tab === 'Business' && <BusinessPanel game={game} me={me} country={country} provinceId={provinceId} setProvince={selectProvince} disabled={disabled} action={action}/>}
        {tab === 'Government' && <GovernmentPanel game={game} me={me} country={country} provinceId={provinceId} setProvince={selectProvince} disabled={disabled} action={action}/>}
        {tab === 'Market' && <div className="tab-content"><div className="section-heading"><div><h2>The player exchange</h2><p>No automatic matching. Accept another company's terms to trade.</p></div><span className="tag">{game.orders.length} OPEN ORDERS</span></div><div className="price-strip">{GOODS.map(g => <div key={g}><span className={`good ${g}`}>{icons[g]}</span><span>{names[g]}<strong>{game.prices[g] ? `${game.prices[g]} cr` : 'No trades yet'}</strong></span></div>)}</div>
          <form className="order-form" onSubmit={e => action({ type: 'order', ...values(e) })}><fieldset disabled={disabled}><label className="field">Order side<select name="side"><option value="sell">Sell goods</option><option value="buy">Buy goods</option></select></label><label className="field">Resource<ResourceSelect/></label><NumberInput name="quantity" label="Units" value={1} max={1000}/><NumberInput name="price" label="Price per unit (cr)" value={10}/><button className="button primary">Post order +</button></fieldset></form>
          <div className="table-wrap"><table><thead><tr><th>Company / resource</th><th>Side</th><th>Units</th><th>Price</th><th>Action</th></tr></thead><tbody>{game.orders.map(o => <tr key={o.id}><td><strong><span className={`good ${o.good}`}>{icons[o.good]}</span> {names[o.good]}</strong><small>{playerName(o.owner)}{o.owner === me.id ? ' · you' : ''}</small></td><td><span className={`side ${o.side}`}>{o.side === 'sell' ? 'ASK' : 'BID'}</span></td><td>{o.quantity}</td><td>{o.price} <span className="muted">cr</span></td><td>{o.owner === me.id ? <button className="text-button" disabled={disabled} onClick={() => action({ type: 'cancel', id: o.id })}>Cancel</button> : <form className="fill-form" onSubmit={e => action({ type: 'fill', id: o.id, ...values(e) })}><input type="number" name="quantity" defaultValue={1} min={1} max={o.quantity} step={1} aria-label={`Units to trade with ${playerName(o.owner)}`} required disabled={disabled}/><button className="button small" disabled={disabled}>{o.side === 'sell' ? 'Buy' : 'Sell'}</button></form>}</td></tr>)}</tbody></table>{game.orders.length === 0 && <div className="empty"><span>⇄</span><h3>The next opportunity is yours.</h3><p>No open orders. Post the first bid or ask—or invite a friend to trade.</p></div>}</div><p className="hint">Goods on asks and credits on bids are held in escrow. Cancel any unfilled remainder to recover them.</p>
        </div>}
        {tab === 'Industry' && <div className="tab-content"><div className="section-heading"><div><h2>Resources & production</h2><p>Every unit starts with your decision. No passive output, timers or regeneration.</p></div></div><div className="industry-grid">{(['ore', 'grain'] as const).map(g => { const home = COUNTRIES.find(c => c.id === me.country)!; return <article className="activity-card" key={g}><span className={`resource-icon good ${g}`}>{icons[g]}</span><h3>Extract {names[g].toLowerCase()}</h3><p>{game.reserves[me.country][g]} left in your shared home reserve.</p><form onSubmit={e => action({ type: 'extract', good: g, ...values(e) })}><fieldset disabled={disabled}><NumberInput name="quantity" label={`Units (max ${home[g]} per action)`} value={home[g]} max={home[g]}/><button className="button">Extract now</button></fieldset></form></article>; })}
          <article className="activity-card"><span className="resource-icon good machines">⚙</span><h3>Manufacture goods</h3><p>Machines: 2 ore + 1 grain.<br/>Provisions: 1 ore + 2 grain.</p><form onSubmit={e => action({ type: 'produce', ...values(e) })}><fieldset disabled={disabled}><ResourceSelect producedOnly/><NumberInput name="quantity" label={`Batch (max ${2 + me.facilities})`} value={1} max={2 + me.facilities}/><button className="button primary">Produce now</button></fieldset></form></article>
          <article className="activity-card"><span className="resource-icon">▦</span><h3>Expand your workshop</h3><p>Consume 4 machines to add 1 unit of batch capacity. No credit sink.</p><strong>{me.facilities} / 8 workshops</strong><button className="button" disabled={disabled} onClick={() => action({ type: 'build' })}>Build · 4 machines</button></article></div></div>}
        {tab === 'Logistics' && <div className="tab-content"><div className="section-heading"><div><h2>Freight & regional supply</h2><p>Send cargo to another country's company. The carrier receives cargo plus your credit reward, and consumes one provision. No transit timer.</p></div></div><form className="contract-form" onSubmit={e => action({ type: 'shipment', ...values(e) })}><fieldset disabled={disabled}><label className="field">Destination<select name="destination">{COUNTRIES.filter(c => c.id !== me.country).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field">Cargo<ResourceSelect/></label><NumberInput name="quantity" label="Units" value={1} max={100}/><NumberInput name="reward" label="Reward (cr)" value={10} max={1000}/><button className="button primary">Offer freight</button></fieldset></form><div className="contract-list">{game.shipments.map(s => <article key={s.id}><div><h3>{s.quantity} {s.good} → {COUNTRIES.find(c => c.id === s.destination)!.name}</h3><p>{playerName(s.owner)} · {s.reward} cr reward · cargo transfers to carrier</p></div>{s.owner === me.id ? <button className="button" disabled={disabled} onClick={() => action({ type: 'cancel-shipment', id: s.id })}>Withdraw</button> : <button className="button" disabled={disabled || (me.country !== s.destination && !game.branches.some(b => b.owner === me.id && PROVINCE_BY_ID[b.province].country === s.destination && branchActive(game, b)))} onClick={() => action({ type: 'deliver', id: s.id })}>Deliver · 1 provision</button>}</article>)}</div>{!game.shipments.length && <div className="empty"><span>↗</span><h3>No cargo awaiting delivery.</h3><p>A player must offer a contract before a carrier can act.</p></div>}</div>}
        {tab === 'Finance' && <div className="tab-content"><div className="section-heading"><div><h2>Human capital</h2><p>Borrow from another player on your terms. No bank, automated interest, deadlines or liquidation.</p></div></div><form className="contract-form" onSubmit={e => action({ type: 'request-loan', ...values(e) })}><fieldset disabled={disabled}><NumberInput name="principal" label="Principal (cr)" value={100}/><NumberInput name="interest" label="Flat interest (cr)" value={10} min={0}/><label className="field">Collateral<ResourceSelect/></label><NumberInput name="collateral" label="Collateral units" value={5} max={1000}/><button className="button primary">Request loan</button></fieldset></form><p className="hint">Collateral is locked. Borrowers can repay voluntarily or settle by surrendering collateral; lenders cannot force repayment. Evaluate collateral before lending.</p><div className="contract-list">{game.loans.map(l => <article key={l.id}><div><h3>{fmt(l.principal)} cr · {l.interest} cr interest</h3><p>{playerName(l.borrower)} · {l.collateral} {l.good} collateral{l.lender ? ` · funded by ${playerName(l.lender)}` : ' · awaiting lender'}</p></div><div className="button-group">{l.borrower === me.id ? <><button className="button" disabled={disabled} onClick={() => action({ type: 'close-loan', id: l.id })}>{l.lender ? 'Repay' : 'Withdraw'}</button>{l.lender && <button className="text-button" disabled={disabled} onClick={() => { if (window.confirm('Settle this debt by permanently transferring your locked collateral to the lender?')) action({ type: 'close-loan', id: l.id, surrender: true }); }}>Surrender collateral</button>}</> : !l.lender ? <button className="button" disabled={disabled} onClick={() => action({ type: 'fund-loan', id: l.id })}>Fund loan</button> : <span className="tag">ACTIVE CONTRACT</span>}</div></article>)}</div>{!game.loans.length && <div className="empty"><span>◇</span><h3>Finance runs on trust.</h3><p>Post a collateral-backed request or lend to another player.</p></div>}</div>}
        {tab === 'Diplomacy' && <div className="tab-content"><div className="section-heading"><div><h2>Build your network</h2><p>Mutual alliances signal cooperation, not automatic rewards or shared assets.</p></div></div><div className="contract-list">{Object.values(game.players).filter(p => p.id !== me.id).map(p => { const alliance = game.alliances.find(a => (a.from === me.id && a.to === p.id) || (a.to === me.id && a.from === p.id)); return <article key={p.id}><div><h3>{p.name}</h3><p>{COUNTRIES.find(c => c.id === p.country)!.name}{alliance ? alliance.accepted ? ' · allied' : ' · invitation pending' : ''}</p></div><div className="button-group">{!alliance ? <button className="button" disabled={disabled} onClick={() => action({ type: 'invite', target: p.id })}>Propose alliance</button> : <>{!alliance.accepted && alliance.to === me.id && <button className="button primary" disabled={disabled} onClick={() => action({ type: 'alliance', id: alliance.id, accept: true })}>Accept</button>}<button className="text-button" disabled={disabled} onClick={() => action({ type: 'alliance', id: alliance.id, accept: false })}>{alliance.accepted ? 'Leave alliance' : 'Withdraw / decline'}</button></>}</div></article>; })}</div>{Object.keys(game.players).length < 2 && <div className="empty"><span>◎</span><h3>Invite another human.</h3><p>Share this world's URL to start cooperating.</p></div>}</div>}
      </div><aside className="right-column"><section className="panel leaderboard"><div className="panel-heading"><div><span className="eyebrow">WORLD STANDINGS</span><h2>The leaderboard</h2></div><span>↗</span></div><label className="sr-only" htmlFor="ranking">Rank by</label><select id="ranking" value={rank} onChange={e => setRank(e.target.value as typeof rank)}><option value="capital">Net financial capital</option><option value="production">Industrial output</option><option value="trade">Completed trade volume</option><option value="logistics">Freight deliveries</option></select><ol>{Object.values(game.players).sort((a, b) => { const metric = (p: typeof me) => rank === 'capital' ? capital(game, p) : rank === 'production' ? p.produced : rank === 'trade' ? p.traded : p.delivered; return metric(b) - metric(a) || a.name.localeCompare(b.name); }).map((p, i) => <li key={p.id} className={p.id === me.id ? 'you' : ''}><span className="rank-number">{String(i + 1).padStart(2, '0')}</span><div><strong>{p.name}{p.id === me.id ? ' · you' : ''}</strong><small>{COUNTRIES.find(c => c.id === p.country)!.name}</small></div><b>{fmt(rank === 'capital' ? capital(game, p) : rank === 'production' ? p.produced : rank === 'trade' ? p.traded : p.delivered)}</b></li>)}</ol><p className="hint">No artificial asset valuations. Different routes have different scoreboards. Trade volume is activity, not profit.</p></section><section className="panel activity"><div className="panel-heading"><div><span className="eyebrow">THE WORLD IN MOTION</span><h2>Activity ledger</h2></div></div><ol>{game.history.slice(0, 12).map(h => <li key={h.revision}><span className="ledger-dot"/><div><p>{h.text}</p><small>COMMITTED REVISION {h.revision}</small></div></li>)}</ol></section></aside></section>}
      <footer><span>ECONRISE <span className="muted">/ A world built by players.</span></span><span>No actions. No economic change.{manualEnabled && !manual && <> · <a href="/?manual=1" target="_blank" rel="noreferrer">Open manual test tab ↗</a></>}</span></footer>
    </main>
  </div>;
}
