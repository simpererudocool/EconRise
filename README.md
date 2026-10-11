# EconRise

Licensed under the repository's existing GNU Affero General Public License v3; see [LICENSE](LICENSE). Natural Earth boundary data is separately public domain.

A playable, simultaneous multiplayer economic strategy game: **Next.js 16 + React 19**, authoritative Node.js Route Handlers, durable transactions, and an interactive geographic world map with country leadership and province-level control. No bots, AI, generated in-game content, scripted traders, automatic matching, economic timers, or external AI calls.

## Quick start (Node 24.x)

```bash
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Select a country on the map, name your company, and join. Local state persists in `.data/econrise.sqlite`; it is not memory-only. Normal tabs share the same cookie-backed company. **Save the private recovery key shown on joining**; it can restore your company in another browser. Never share it.

### Testing alone with separate human players

Copy `.env.example` to `.env.local`, leaving only `ECONRISE_MANUAL_TEST=1` active, and restart the server. Open `http://127.0.0.1:3000/?manual=1` independently in multiple tabs. Each uses a tab-local session token; name them differently and manually issue actions. Do not duplicate a tab containing a session if you want a new identity. This is an authentication/testing convenience only; exactly the same economy rules apply. It is forcibly disabled when `VERCEL` is set. There are no economic agents acting for you.

For local production:

```bash
npm run build
ECONRISE_LOCAL=1 npm start
```

The environment prefix uses Bash (Git Bash on Windows). For networked local testing bind Next to your LAN address with `next dev --hostname 0.0.0.0`; retain same-origin requests. Share the server address with other human players. Use HTTPS and production configuration outside trusted local testing.

## Deploy on Vercel — real, durable multiplayer

A persistent in-memory Node/WebSocket process is **not** used. Every Vercel instance shares one PostgreSQL world; losing or scaling a function cannot fork the economy. Supabase hosts PostgreSQL and browser realtime WebSockets. No Supabase service-role key or database password is exposed to browsers.

1. Create a **dedicated Supabase project** at https://supabase.com/dashboard. The integration discovery catalog had no matching combined Postgres/realtime service, so this implementation uses the provider's official documented APIs.
2. Execute [`database/schema.sql`](database/schema.sql) in its SQL editor. This creates the private authoritative state and the public **revision-only** realtime table. Browser roles have no write access, and cannot read state or session hashes through Supabase.
3. From **Connect → Transaction pooler**, copy the database URI (typically port 6543). URL-encode password special characters. Remove `sslmode`, `sslcert`, `sslkey`, and `sslrootcert` query options; the app's `pg` configuration requires TLS with certificate verification, not insecure TLS. Add `DATABASE_URL` to **Vercel server-side environment variables**, not `.env.example` or source control.
4. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` using your project's public URL and publishable/anon key. These are intentionally browser-public; access controls are in the SQL migration.
5. Add `APP_ORIGIN`, your exact stable HTTPS origin (e.g. `https://econrise-example.vercel.app`, no trailing slash/path). Every mutation checks it. Configure a separate value for a separate preview origin. Never trust a user-supplied Host as a production origin.
6. Import this repository into Vercel, select Next.js and **Node 24.x**, run the default `npm run build`, and deploy. Do **not** enable local mode on Vercel. Missing database/origin configuration fails closed. This project does not need a separate Node host.
7. Invite two humans using different browser profiles/devices. Join, post and fill an order, refresh/reconnect, and verify that both see the same committed revision. Check the browser network for the Supabase subscription and `/api/game`. Disable network, restore it, and verify recovery. Test on the actual deployed HTTPS origin before calling it launch-verified.

Realtime is an optimization, not authority: subscribers see only an integer revision and refetch authenticated state. Polling every 2.5 seconds while the page is visible recovers missed notifications or unconfigured realtime. Subscription failure does not drop committed actions. Real multiplayer still works over polling, with bounded notification delay and additional function/database costs.

**This repository is Vercel-compatible; a deployed Supabase/Vercel environment needs your credentials. No live production deployment or configured PostgreSQL integration is claimed by the local test results.** Use a dedicated Supabase test project to run the actual database lock integration test below.

## Play loop

- **Select a country:** All start with 1,000 cr, 12 ore, 12 grain, 2 machines, and 2 provisions. Countries may have multiple companies; human players compete over finite country reserves.
- **Extract:** Click to take 1–6 ore or grain (country-specific cap) from your country's shared reserve. Each country starts with 300 of each. No regeneration or passive income.
- **Produce:** Click to consume recipe inputs. One machine costs 2 ore + 1 grain; one provision costs 1 ore + 2 grain. Base maximum batch is 2; consume 4 machines per workshop to add 1, up to 8 workshops. Nothing runs unattended.
- **Market:** Players set bids/asks (integer credits per unit). Asks escrow goods, bids escrow credits. Another player explicitly fills all or part. No self-trades, automatic matching, NPC liquidity, price oracle or generated orders. Last executed price is shown only after a real human-to-human fill. Cancelling releases the unfilled escrow.
- **Freight:** Offer an explicitly described cargo-plus-credit grant to a company in a different destination country. Cargo and reward are escrowed. A human in that country accepts, consumes 1 provision, and receives the cargo plus reward. Cargo **is payment in kind**, not a return shipment; this lets players negotiate regional supply and alliances. There is no movement simulator or transit timer. Owners can cancel unaccepted contracts.
- **Finance:** Request a principal with flat interest and collateral you choose. Another player funds from existing credits. Borrowers voluntarily repay principal + interest to recover collateral, withdraw an unfunded request, or settle by surrendering collateral. Lenders cannot force repayment or auto-liquidate; evaluate collateral and trust. No automatic interest accrual, due dates, bank or credit creation.
- **Diplomacy:** Propose an alliance. The other human must accept. Alliances signal cooperation; they do not generate money, unlock free resources, or transfer assets. Either party can leave.
- **Progress:** Switch between net financial capital, manufactured output, completed trade volume, and freight deliveries. Financial capital is cash + credit escrow + lender principal receivables − funded borrower principal/interest liabilities. Goods have **no scripted monetary valuation**. Trade volume is activity, not wealth, and can be inflated by cooperating humans; it is not a victory metric. No single automatic winner.

### Player-only economics by construction

`lib/game.ts` is a pure state transition function. It has no clock, network, randomness, imports for AI, background jobs, or economic actors. It accepts an authenticated human's action and returns a new state or rejects atomically. Economic mutations are reachable only through join or explicit action requests. Reading state, disconnecting, reconnecting, subscriptions and polling do not extract, produce, transfer, reprices, or regenerate anything.

The sole monetary endowment is the documented **one-time 1,000 cr founding grant per admitted company**. After joining, total credits (cash plus bid/freight escrow) are conserved. Recipes, construction and freight can consume goods only at a human's request. Finance transfers existing money. Extraction transfers existing finite reserves. No player action means no economic change. There is no economic randomness; country capabilities and recipes are fixed and visible. Geographic boundaries are locally bundled Natural Earth reference data; military control is fictional, not authoritative political geography.

## More countries and business branches

**24 playable countries:** Canada, Brazil, United Kingdom, Egypt, South Africa, India, Japan, Australia, United States, Mexico, Argentina, Chile, Peru, France, Germany, Spain, Italy, Norway, Türkiye, China, Indonesia, South Korea, Nigeria and Kenya. Every country retains equal starting endowments and an ore/grain extraction-cap total of 10. The world remains capped at 32 human companies; more countries do not raise a company's grant or create NPC governments.

Open **Business**, select a country on the map and choose a province. An **unconquered** business site means its controller is its original country, that country has no active war or rebellion, and no branch already occupies that province. Ungoverned territory is eligible: players can operate without inventing a government actor. Opening costs **2 machines + 2 provisions**, one slot per province, up to six branches per company. Opening is a player action, not an automated expansion.

Branches let their owner explicitly extract from the host country's **existing finite shared reserve**, using that country's caps, and accept freight destined there. They do not generate new goods/cash, grant citizenship/votes/government power, change borders, or operate unattended. Production and inventories stay company-wide. War, rebellion or occupation suspends local branch extraction and freight eligibility without confiscating assets; after explicit peace/restoration, eligibility can recover. Only the owner can close a branch, with no setup refund. Site versions and database locking guarantee that simultaneous contenders cannot both take the same slot.

## Governments, rebellions and provincial warfare

Open **Government** in the activity tabs. Choose a country in the map toolbar and use **Province view** to inspect individual regions; clicking a province selects it in the command panel. Zoom, directional pan, reset, keyboard-accessible province paths and a dropdown make even small subdivisions selectable. The world draws 257 reference areas and 1,060 playable subdivisions across 24 countries. Other countries are geographic background, not NPCs or conquerable actors.

### Player-run countries

- A resident explicitly founds an ungoverned country's government by consuming **4 machines + 4 provisions**. The first valid claim wins; founding is not automatic on joining. Other residents retain all company assets and ordinary market/production access. Leadership creates no income, taxes, automated administration or new assets.
- A resident can challenge the incumbent by spending **2 machines + 2 provisions** to open an election. One election per country. The electorate is frozen to residents present at nomination; new arrivals cannot stack that election. Every vote is an explicit action, one per eligible player. A **strict majority** elects the candidate immediately; no timer or automatic vote. Candidates may withdraw without a refund. Voting and leadership changes never redistribute company property.
- A rebellion requires another human-led home government. Commit **at least 6 units**, each consuming one machine + one provision, **plus 4 machines + 4 provisions** to organize: minimum **10 of each** available. Start in a home-controlled province. Its existing human-deployed garrison can defeat the initial attempt, but the faction remains to permit subsequent human commands. One rebellion per home country; elections are suspended while it exists.
- Rebel commanders can reinforce and advance inside their home country. Capture the capital and a **strict majority of original provinces** to replace the government. Rebel-held provinces then become national territory; foreign occupations remain. Rebellions can be voluntarily disbanded; their territory returns to home control and deployed resources are lost. No automated rebellion, protest generation or suppression.

### Borders, wars and battles

- Only national leaders declare wars, and targets must already have a **human leader**. Declaration costs **2 machines + 2 provisions**. No neutral AI armies; no invasion of ungoverned background countries. War status is independent of player alliances and does not impose market embargoes.
- National leaders/rebel commanders deploy **1–50** units per command to faction-held provinces. Each costs **1 machine + 1 provision**, consumed from that player's available inventory. Garrisons are persistent human-committed military resources, not autonomous actors, and cap at 100. Governors cannot spend citizens' goods.
- Attack strength is committed units; defense is the stationed garrison. Losses cancel one-for-one. **Ties defend.** If attack exceeds defense, ownership changes and the surviving attack units form the garrison. No random rolls, automatic marches, battles, attrition, regeneration or economic ticks.
- Advances follow **shared-edge province adjacency** derived from the unsimplified map. An overseas expedition may enter a target country's exterior-border province for **3 additional provisions**. “Exterior” includes coastline and international boundaries; this core abstracts sea/land transport and is not a military route simulator. Interior provinces require an adjacent controlled province. Detached island subdivisions need expedition entry. Rebels have no overseas entry privilege. A government fully expelled from home can explicitly launch recovery through an exterior province.
- Occupied provinces inherit their controller country's color; rebels are purple and occupation is hatched. **Red control frontier segments follow actual shared geographic edges**, rather than fabricated straight front lines. Country outlines mark active wars. Reference administrative boundaries remain visible inside countries.
- Every province command carries the viewed province version. The server rejects stale/conflicting commands before spending goods. Database ordering plus action-sequence idempotency still applies; no client owns territory.
- Leaders explicitly offer/accept peace. Both retain held provinces until future player commands change them. Foreign capture does not remove another country's government or confiscate its cash/inventory. Conquest currently changes military/map control, not extraction rights or passive tax yield—avoiding a runaway economic snowball.

### Local map copies, licensing and migration

The supplied `ne_10m_admin_0_countries.geo.json` and `ne_10m_admin_1_states_provinces.geo.json` are read by `npm run map:build`. No download is made by that command. The supplied 110m copy is retained untouched; the detailed 10m layers match country/province borders more closely. Generated `public/maps/world.json` is under 4 MiB and shipped with the app; normal build and play need no raw source files or mapping API. Source hashes and [attribution](public/maps/ATTRIBUTION.md) are included. Natural Earth data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/); its de facto/generalized boundaries and beta subdivision layer are cartographic references, not a political/legal statement. The UK's many local administrative areas differ from other countries' province granularity; this is disclosed rather than presented as equal large states.

Existing schema-1/schema-2 worlds upgrade to schema 3 without deleting players, sessions, markets, reserves or balances. Read-only compatibility adds neutral political metadata; the next successful locked command persists it. The existing Supabase schema migration stays valid and requires no extra hosted tables. Migration does not create leaders, money, garrisons or a new economic revision. New worlds start with the same neutral politics by construction. New countries add their documented finite 300/300 reserves, not cash or player goods; existing reserves, occupations and leaders are preserved.

## Real-time and concurrency design

Players should react, negotiate and trade together without a turn barrier, so commands may arrive at any moment. Next.js Node Route Handlers validate actions and commit a short transaction. PostgreSQL `SELECT ... FOR UPDATE` serializes commands on the world row, **across Vercel instances**. SQLite uses `BEGIN IMMEDIATE` locally. Every successful transition receives a unique increasing revision.

“Simultaneous” has no globally observable browser clock. The canonical ordering is **database lock acquisition/commit order**, not client timestamps. Given that server-assigned sequence, transitions are deterministic; conflicting later actions see the updated state and fail without side effects. We do not promise geographic latency fairness. Two buyers cannot spend the same goods, and two lenders cannot fund the same request. Failed rules roll back balances, escrow and revision.

Each authenticated session has a contiguous monotonic action sequence. The client stores an unconfirmed action in tab-local storage and retries the **same sequence and payload** after an uncertain connection result. The server stores the last 64 payload hashes/receipts. Matching retries return state without re-executing; mismatched payloads conflict, and older evicted sequences remain rejected by the monotonic watermark. An action rejected by a rule does not consume its sequence. State survives disconnects and process restarts. Stale commands from another tab receive 409 and refetch; clients cannot choose identities or balances through action JSON.

## Balance and operating envelope

- Country ore + grain per-action capacity always totals **10** (6/4, 4/6, or 5/5). Every country has identical reserves, founding assets, recipes and market access. No home receives free machines, money or exclusive recipe bonuses.
- Specialized countries differ in convenient extraction, not guaranteed profit. Ore and grain have symmetric production sinks. Industries compete for raw goods; traders need counterparts; lenders risk illiquid collateral; freight needs other regions and consumes provisions. Workshops offer action efficiency at a goods opportunity cost, never passive output.
- Per-company caps: 12 orders, 4 loans, 4 freight offers, 8 workshops; action and trade amount caps are validated server-side. 32 admitted companies share one world; the ledger retains the latest 60 events. Reserves are deliberately exhaustible: mature worlds rely on previously extracted goods and player negotiation. No hidden replenishment.
- Security limit: 20 successful actions per 10 seconds per session; at most 8 new companies per address per hour. Security timestamps never advance the economy. These limits are not an anti-Sybil identity system or a gameplay turn mechanic.
- Balance is transparent and tunable, not claimed mathematically solved. Unlimited manual extraction is limited by stock and action limits, and multiple scoreboards avoid assigning a fake price-based winner. Bots/scripts written by malicious outsiders cannot be conclusively identified as human from HTTP alone; the shipped game contains **zero automated economic actors**. An open competitive launch needs stronger identity/abuse policies.

## Verification

```bash
npm run typecheck
npm test
npm run build
# or all three:
npm run check
```

Tests cover invalid trades and payloads, credit/goods conservation, escrow and cancellation, finite reserves, production, loan repayment/surrender, destination restrictions, mutual alliances, inactivity, forged sessions, HTTP origin/size checks, durable reconnect after process restart, concurrent scarce-order fills, competing lenders, replay safety, atomic rollback, and admission/action rate limits. Test fixtures represent manually chosen requests; they are not game runtime bots.

To verify **actual PostgreSQL concurrency** use a migrated **disposable** Supabase test project (never your live world). This explicit suite resets its state:

```bash
TEST_DATABASE_URL='your-private-test-pooler-uri' \
TEST_DATABASE_RESET=I_CONFIRM_THIS_IS_A_DISPOSABLE_DATABASE \
npm run test:postgres
```

That test creates two independent PostgreSQL stores (like separate Vercel instances), races two fills, checks one winner, verifies revision notifications, retries safely, and verifies rollback/reconnect. It fails with a clear setup error if credentials/explicit reset confirmation are absent; it is not silently skipped or reported as passing.

### Latest expansion verification

- TypeScript, all **38 automated tests**, and the optimized production build passed after the final source changes. Production dependency audit reported zero vulnerabilities.
- Browser controls opened Summit's branch in France, extracted from the French grain reserve, manufactured supplies, and founded Canada's player government. The map exposes 24 country choices and renders the supplied local geography; a 390px viewport had no horizontal overflow.
- Rebellion outcomes, elections, foreign provincial conquest/peace, stale military commands, and simultaneous branch/leadership claims were verified by automated rule/service tests. Full browser war/rebellion campaigns were not completed; do not interpret unit coverage as a live multi-device campaign test.
- Hosted PostgreSQL, Supabase realtime and actual Vercel deployment still require credentials and remain unverified. No measured large-world performance claim is made.

### Earlier core verification performed in this workspace

- Node 24.21.0; `npm run typecheck`, the original **20** `npm test` cases, and `npm run build` passed after the final fixes.
- Two separate browser players selected Canada/Brazil, posted/filled an ore ask, and observed the same balances and revision. Extraction, manufacturing and mutual alliance acceptance were exercised through visible controls.
- Normal cookie-backed session retained its identity after page reload. The optimized production server also rendered the saved world with no browser console errors; signed-out snapshots returned 401.
- Desktop and 390px mobile screenshots inspected; no horizontal mobile overflow. Local request hostname normalization and map coordinate scaling issues were repaired and regression checks rerun.
- Actual Supabase/PostgreSQL locking, hosted realtime delivery, and a live Vercel deployment were **not verified**: no hosted credentials were supplied. The explicit database integration suite and deployment steps above remain required before launch. No load/capacity or anti-Sybil guarantees are claimed.

### Security & operations

Session cookies are HttpOnly/SameSite=Strict and Secure on HTTPS; session secrets are hashed at rest. A recovery key is a bearer credential, shown once to its owner, not published in snapshots or logs. Manual tab bearer tokens work only in explicitly enabled non-Vercel local testing. World information (holdings, offers, actions) is intentionally public **to joined players**; credentials are private. No browser direct database mutation permissions. Private responses are `no-store`; mutations require exact Origin and JSON, bounded to 4 KiB. Queries use bound parameters, strict numeric/resource checks, transactions, TLS and finite timeouts; unexpected failures produce a safe 503.

Use a dedicated project or a restricted database role, retain database backups, keep dependencies patched, configure Vercel rate limits/WAF for abusive unauthenticated traffic, and observe function errors/DB saturation. IP admission limiting is supplemental; it cannot guarantee one company per real human. There is no user account/email verification, credential revocation UI, admin console, or multi-world management in this core. Do not promise competitive identity guarantees or delete live player data to reset a demo. A single world row is intentionally a coherent small-world serialization boundary, not a massive-scale architecture. Performance/capacity requires workload testing before increasing the 32-company cap.

## Project structure

```text
app/
  api/game/route.ts        authoritative GET snapshots and POST commands
  globals.css             responsive dashboard/map styles
  layout.tsx              page metadata and root layout
  page.tsx                server entry and manual-test configuration
components/
  GameClient.tsx          React interface, HTTP actions and realtime/reconnect
  WorldMap.tsx            geographic map, zoom/pan and provincial control frontiers
  GovernmentPanel.tsx     leadership, elections, rebellions and war controls
  BusinessPanel.tsx       branch opening, closure and manual extraction
lib/
  game.ts                 pure deterministic rules and typed game state
  service.ts              sessions, action sequences, limits and transactions
  store.ts                SQLite/PostgreSQL durable transaction adapters
  politics.ts             government and deterministic provincial battle rules
  territories.json        stable geographic IDs, capitals, adjacency and entry metadata
  countries.json          balanced 24-country catalog shared with map processing
public/maps/              optimized map, front-line segments and source/license records
scripts/build-map.mjs     offline processing of user-provided local GeoJSON copies
database/
  schema.sql              Supabase private state + revision-only realtime RLS
tests/
  game.test.ts            economy rules and conservation
  politics.test.ts        maps, elections, rebellions, battles, peace and conflicts
  business.test.ts        site eligibility, branch access and simultaneous claims
  service.test.ts         persistence, conflicting commands, retries and auth
  api.test.ts             actual Route Handler security and recovery
  postgres.integration.ts optional explicit live-database lock check
.env.example              configuration template, no secrets
.gitignore
next.config.ts
tsconfig.json
package.json
package-lock.json         reproducible installs
README.md
```

## Deliberately future extensions (not broken stubs)

Accounts and verified identity/anti-Sybil admission, revocable sessions, multiple rooms/seasons, consensual shared treasuries, privately negotiated contracts, return-cargo freight routing, richer geographic routes, opt-in auction rules, persistent chat/moderation, full-history analytics, load tests and world partitioning. None may introduce automated traders, hidden AI price setting, or non-player economic actors. Any future scheduled action must be explicitly human-authorized and reconsider the strict no-action/no-change rule.

## Reference decisions

- [Next.js Node Route Handler runtime](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config)
- [Vercel WebSocket/function lifecycle limitations](https://vercel.com/docs/functions/websockets) — even where beta support exists, ephemeral function connections are not a durable authoritative world.
- [Supabase serverless transaction pooler](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html)
- [node-postgres transaction client requirement](https://node-postgres.com/features/transactions)
