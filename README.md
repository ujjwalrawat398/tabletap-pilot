# TableTap — Restaurant NFC/QR Ordering Platform

Built by **U&D Digital Studio**. A guest taps an NFC tag or scans the QR on the table, a mobile
page opens instantly, the waiter reads out the 4-digit table code, and they order, review, join the
Wi-Fi and play a quiz — no app, no login.
Staff confirm orders on a Waiter PWA, cook from a Kitchen screen, and run the restaurant from an
Admin panel.

Everything in this repository runs for **₹0/month** on free tiers (see [Cost & deployment](#10-cost--deployment)).

---

## Contents

1. [What is in the box](#1-what-is-in-the-box)
2. [Run it in 60 seconds (demo mode)](#2-run-it-in-60-seconds-demo-mode)
3. [Architecture](#3-architecture)
4. [Production setup: Supabase + Cloudflare/Vercel](#4-production-setup)
5. [Environment variables](#5-environment-variables)
6. [Database, RLS and security model](#6-database-rls-and-security-model)
7. [Feature walkthrough (all 5 phases)](#7-feature-walkthrough)
8. [Roles and accounts](#8-roles-and-accounts)
9. [Printing QR codes and writing NFC tags](#9-printing-qr-codes-and-writing-nfc-tags)
10. [Cost & deployment](#10-cost--deployment)
11. [Backups](#11-backups)
12. [Testing](#12-testing)
13. [Ops checklist for a live restaurant](#13-ops-checklist-for-a-live-restaurant)
14. [Project structure](#14-project-structure)
15. [Roadmap / known limits](#15-roadmap--known-limits)

---

## 1. What is in the box

| Phase | Delivered |
| --- | --- |
| **1 — MVP** | Project setup, schema + RLS, NFC/QR table sessions, menu with offers & sold-out, shared multi-guest cart, send order, waiter confirm/reject, kitchen screen, staff login, admin menu management |
| **2** | Call waiter + request bill with distinct sounds, table status grid, offers & one-tap sold-out, sales reports with CSV, PWA install + Web Push |
| **3** | Wi-Fi card with copy + auto-join QR, star rating with Google/private routing, private feedback inbox, live order status for guests |
| **4** | Quiz: solo + "play with my table", question bank, CSV bulk import, server-side scoring with speed bonus |
| **5** | Whole-restaurant timed rounds every N minutes, daily leaderboard with prizes, admin prize management |
| **Waiter OTP** | Waiter-issued 4-digit table codes instead of auto-sessions: code screen (Hindi + English), read-only menu preview, code cards on the waiter/admin board (Dismiss / New code / New party), idle + hard-cap clocks, device cap, panic action, cron cleanup, settings page |

Also included: printable table QR PDF, seed data (demo restaurant, 10 tables, 28 dishes,
40 quiz questions), `.env.example`, a one-page staff guide
([`docs/staff-guide.md`](docs/staff-guide.md)), an automated **119-check smoke test**, a
**38-check security suite**, and per-phase test checklists in [`docs/testing.md`](docs/testing.md).

---

## 2. Run it in 60 seconds (demo mode)

No database to install. The app embeds **PGlite** (PostgreSQL compiled to WebAssembly) and
creates the schema + demo data on first boot.

```bash
npm install
cp .env.example .env.local        # optional for local dev
npm run dev
```

Open **http://localhost:3000**

1. Press **Start the demo** — it creates the three demo staff logins and hands you the guest link.
2. Press **Open** on *Guest view · Table 1* — that is exactly what a guest sees after scanning.
3. Sign in at `/staff/login` as `admin@spiceroute.test` / `Demo@1234`; the waiter and kitchen
   accounts use the same password.

> Demo data is in memory: restarting the dev server resets it. Set `PGLITE_DIR=.pglite` in
> `.env.local` to keep it on disk.

To run the automated end-to-end tests against the running server:

```bash
npm run test:smoke        # 63 API checks: order flow, roles, security, scoring
npm run test:games        # server-clock games: 25 s lobby, 15 s questions, no late joiners, no hints, team scoring, admin-started restaurant game
npm run test:password     # staff password flow: waiter asks, admin approves / rejects, admin self-change
npm run test:e2e -- <table_code>   # browser test (Playwright): scan → cart → order → waiter → kitchen → guest
```

`flow.mjs` needs `npx playwright install chromium` once. It prints the table code to use and
saves screenshots of each screen to `/tmp/shot-*.png`.

> Both suites reset the demo database themselves (`POST /api/demo/reset`, embedded demo mode
> only — it refuses to run against Postgres), so they are safe to run repeatedly. The API suite
> stops with a clear message if a login rate limit is still warm, which only happens when it is
> pointed at a server you have been clicking through by hand: `rm -rf .pglite` and restart.

---

## 3. Architecture

```
Guest phone ──QR/NFC──►  middleware.ts ──► /t/{table_code}  (App Router server components)
                          │  mints the HttpOnly session cookie on first scan
                          │  (only the SHA-256 hash of the token is stored)
                          ▼
                    /api/public/*          validated with Zod, rate limited
                          │
Waiter PWA  ─────────────►/api/waiter/*    role-checked on the server
Kitchen PWA ─────────────►/api/kitchen/*   role-checked on the server
Admin panel ─────────────►/api/admin/*     admin-only, audit logged
                          │
                          ▼
                PostgreSQL (Supabase)  ── RLS on every table
                          │
                          └── Supabase Realtime ──► staff devices (live orders/calls)
                              Web Push ──────────► background alerts
```

Key decisions:

* **One language, one repo.** TypeScript everywhere; SQL only in migrations and repository
  functions with parameterised queries.
* **Customers never touch the database.** There is no anon key in the customer bundle. Every
  guest read/write goes through a server endpoint authenticated by the table-session cookie.
* **Two database drivers behind one interface** (`src/server/db.ts`): PGlite for local/demo,
  `pg` for Supabase/Postgres. Same SQL both ways, so what you test locally is what ships.
* **Realtime with a graceful fallback.** Supabase Realtime broadcast/Postgres-changes when
  configured; otherwise staff screens poll a tiny fingerprint endpoint. The audio + refresh path
  is identical, so the demo behaves like production.
* **Sounds are synthesised** with the Web Audio API — no audio files, no caching/CORS issues,
  and admin can choose a different sound per event.
* **Security defaults fail closed.** A missing/weak `SESSION_SECRET` throws in production instead of
  falling back to a known string; the cron route answers 503 rather than running unauthenticated;
  the Wi-Fi password is not part of any general payload. See §6 for the full table.
* **A scan grants nothing; a waiter's code does.** Tapping the sticker lands the guest on a code
  screen. `POST /api/public/session` raises (or reuses) a 4-digit code for that table and pings the
  waiter's phone; the code itself only ever appears on the waiter/admin board and in the push
  notification. The session — and its HttpOnly device cookie — is created by
  `POST /api/public/verify-otp` when the guest types that code. `middleware.ts` only routes
  (sub-pages without a session are sent back to the landing page); it never writes cookies.

---

## 4. Production setup

### 4.1 Supabase

1. Create a project at [supabase.com](https://supabase.com) (free plan).
2. **SQL Editor** → run, in order:
   * `supabase/migrations/0000_bootstrap.sql` (no-op on Supabase, safe)
   * `supabase/migrations/0001_schema.sql`
   * `supabase/migrations/0002_supabase_auth.sql` (auth wiring, storage bucket)
   * `supabase/migrations/0003_local_auth.sql` (no-op on Supabase, safe)
   * `supabase/migrations/0004_session_devices.sql`
   * `supabase/migrations/0005_hardening.sql`
   * `supabase/migrations/0006_table_otp.sql` (waiter table codes, session clocks, settings)
   * `supabase/migrations/0007_staff_password_requests.sql` (waiter / kitchen password-change requests)
   * `supabase/migrations/0008_game_player_left.sql` (a guest who quits a table game is out of it)
   * `supabase/migrations/0009_restaurant_game_events.sql` (admin-started restaurant games: cancel reason, "prize given")
   * `supabase/seed/seed.sql` (demo data — skip for a real client, see 4.4)

   Or with the Supabase CLI: `supabase link --project-ref <ref> && supabase db push`.
3. Copy credentials into `.env.local`:
   * Project Settings → API → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY` (server only!)
   * Project Settings → Database → Connection string → **Session pooler** →
     `DATABASE_URL`
4. Create staff logins: `npm run seed:staff` (or add them from **Admin → Staff** later).
5. Generate VAPID keys for Web Push: `npx web-push generate-vapid-keys`, then set
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
6. Auth → Providers → Email: turn **off** "Confirm email" for staff accounts (they are created by
   an admin, not self-registered).

### 4.2 Cloudflare Pages (recommended for paying clients)

Cloudflare Pages' free tier explicitly permits commercial use, unlike Vercel Hobby.

```bash
npm i -D @cloudflare/next-on-pages
npx @cloudflare/next-on-pages          # builds .vercel/output/static
npx wrangler pages deploy .vercel/output/static
```

* Set the environment variables from `.env.example` in the Pages dashboard.
* Add a Cron Trigger (or a free external cron) that calls
  `https://your-domain/api/cron/housekeeping?key=$CRON_SECRET` every 5 minutes — it closes expired
  table sessions, frees tables, closes abandoned waiter calls and prunes rate-limit rows.
* Node runtime is required for the API routes (PGlite is not used in production; `pg` is).

### 4.3 Vercel (fine for demos)

`vercel --prod` with the same environment variables. Hobby is **non-commercial only** — for a
paying client either use Cloudflare Pages or upgrade to Vercel Pro.

### 4.4 Onboarding a real restaurant

1. Sign in as admin → **Admin → Settings**: name, logo URL, accent colour, Wi-Fi, Google review
   link, tax/service charge, alert sounds, game settings.
2. **Admin → Menu**: replace the demo dishes with the real menu (categories, prices, offers).
3. **Admin → Tables**: create tables in the real floor order.
4. **Admin → Tables → Download printable QR sheet (PDF)** — print at 100% on A4, cut and stick.
   Write the same URL into NTAG213 stickers for tap-to-order.
5. **Admin → Staff**: create waiter and kitchen logins, then disable/delete the demo accounts.
6. **Admin → Games**: import your quiz bank (CSV) and set the daily prizes.

To run several restaurants on one Supabase project: every row carries `restaurant_id`, RLS scopes
staff to their own restaurant, and `staff_profiles` decides which one. Create the second row in
`restaurants`, then create its staff accounts — the data model and policies already support it.

---

## 5. Environment variables

See [`.env.example`](.env.example) for the full annotated list.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | yes | Base URL used in QR codes, NFC links and printable PDF |
| `SESSION_SECRET` | yes in production | HMAC key for the staff session cookie. Missing, < 32 chars or a placeholder → production refuses to sign in. Local `dev`/`start` generate one into `.env.local` |
| `DATABASE_URL` | production | Supabase/Postgres connection string. Empty = embedded PGlite |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production | Supabase Auth + Realtime from the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | production | **Server only** — creates/deletes auth users, server DB access |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | for push | Web Push alerts |
| `CRON_SECRET` | recommended | Protects `/api/cron/housekeeping` |
| `DEMO_PASSWORD` | optional | Password for the demo logins (`/setup`, `npm run seed:staff`) |
| `DEMO_MODE` | production: leave unset or `off` | Demo/test routes (`/api/setup`, `/api/demo/*`, `/api/dev/clock`, `/setup`) are closed in production by default. `on` re-opens them on purpose (for example a local `npm start` demo) |
| `PGLITE_DIR` | optional | Persist the embedded local database to disk |

Never commit `.env.local`. The service-role key must never reach the browser bundle — the only
Supabase credentials in client code are the URL and the anon key, and the staff realtime socket
authenticates with the staff member's own JWT so RLS still applies.

---

## 6. Database, RLS and security model

**Tables** (all migrations in `supabase/migrations`):
`restaurants`, `staff_profiles`, `staff_credentials` (local mode only), `tables`,
`table_sessions`, `table_session_devices`, `menu_categories`, `menu_items`, `carts`, `cart_items`,
`orders`, `order_items`, `waiter_calls`, `reviews`, `feedback`, `quiz_categories`,
`quiz_questions`, `game_rounds`, `game_players`, `game_answers`, `game_scores`, `prizes`,
`settings`, `audit_log`, `push_subscriptions`, `rate_limits`.

How each security requirement is met:

| Requirement | Implementation |
| --- | --- |
| HTTPS only, secure cookies | HSTS header + `secure`, `HttpOnly`, `SameSite=Lax` session cookies |
| RLS on every table | `enable row level security` on all tables; anon has **no** table grants at all |
| Staff see only their restaurant | `auth_restaurant_id()` helper used in every policy; writes for admin, operational writes for waiter/kitchen |
| Customers never touch tables | No anon grants; guest traffic goes through `/api/public/*` authenticated by the session cookie |
| Only a hash of the token is stored | `table_sessions.token_hash`, `table_session_devices.token_hash` are SHA-256; the raw token lives only in the cookie |
| Never trust client prices | `sendOrder()` re-reads prices from `menu_items_public` and recomputes subtotal/tax/total server-side |
| Zod on every input | `src/lib/validation.ts`, enforced with `parseBody()` in every route |
| Parameterised queries only | `src/server/db.ts` — no string interpolation of values anywhere |
| Rate limits | Postgres-backed fixed windows: **scans (120 / 10 min per IP)**, **code entries (60 / 10 min per IP)**, orders (6 / 5 min per session), waiter calls (1 / 30 s per table + type), quiz answers (40 / 5 min per player), login (8 / 10 min per IP+email). Both guest limits are deliberately generous: every phone in the room shares the restaurant's Wi-Fi IP |
| Role checks on the server | `requireStaff(['waiter'])` etc. in every staff route, plus RLS |
| Passwords | Supabase Auth in production; scrypt in local mode; admin can force-reset from the Staff screen |
| Service-role key server only | Imported only in `src/server/*`; no `NEXT_PUBLIC_` prefix |
| Security headers | CSP, X-Frame-Options DENY, HSTS, nosniff, Referrer-Policy, Permissions-Policy in `next.config.ts` |
| XSS on user text | `sanitizeText()` strips tags/control chars before storage; React escapes on render; CSV export escapes formula injection |
| Upload limits | Storage bucket limited to 200 KB and `webp/jpeg/png` only |
| Audit log | `audit_log` rows for price/offer changes, sold-out toggles, menu edits, staff create/update/delete, order rejection, session close, settings changes, quiz imports — append-only RLS |
| Fake orders | An order reaches the kitchen only after a waiter confirms it, from a live, unexpired session; closing a table session invalidates every device token instantly. The waiter ticket shows **how long the table has been open and how many phones joined**, so an order from a table nobody was seated at is obvious |
| Session secret | `getSessionSecret()` throws in production when `SESSION_SECRET` is missing, shorter than 32 chars or still a placeholder, so a forgotten env var can never ship a forgeable staff cookie |
| Table code (OTP) | A scan creates no session. The waiter reads out a 4-digit code (range 4–6) that exists only on the staff board, in the push notification and in `table_otps`; it never appears in a customer response, a URL, the page source or a log, and it is never written to the audit log. One live code per table (partial unique index), 10-minute window, 5 wrong tries (counted by a single atomic statement, non-digits rejected before they count), 60-second re-issue cooldown, deleted by cron after 24 hours |
| Session clocks | Every session lookup enforces both clocks with database time: 90-minute idle window (30–240, slid by activity) and a 4-hour hard cap (1–8) that activity can never extend. Guest code entries are rate limited per IP (60 / 10 min) and scans at 120 / 10 min, because a whole restaurant shares one Wi-Fi IP |
| Device cap | At most 12 phones per table session (`max_devices_per_session`, 4–20); the 13th code entry gets a clear 409 instead of overwriting another guest's device token |
| Wi-Fi credentials | Never in the scan response or the state payload — only `POST /api/public/wifi` and the `/wifi` page, and only for a live device token |
| Concurrency | Order status changes are compare-and-set (`update ... where status = any(...)`), so two waiters pressing Confirm/Reject at once get one 200 and one 409. `unique(session_id, batch_no)` (migration 0005) keeps batch numbers unique, with a retry on conflict |
| Demo routes | `/api/setup`, `/api/demo/seed`, `/api/demo/reset`, `/api/dev/clock` and the `/setup` page share one gate (`src/server/demo-gate.ts`): open only on the embedded database (never on a real Postgres, even with `DEMO_MODE=on`) and, in production, only with an explicit `DEMO_MODE=on`. Production also refuses to start without `DATABASE_URL`. Covered by `npm run test:prod` |
| Staff passwords | Admin changes their own password immediately but must enter the current one. Waiter and kitchen accounts enter the current password, pick a new one, and it only takes effect after an admin approves it (Admin → Staff). The requested password is stored AES-256-GCM encrypted until the decision, then wiped; admins never see it. An admin can still set a temporary password for someone else. Covered by `npm run test:password` |
| Cron | `/api/cron/housekeeping` requires `CRON_SECRET` (Bearer / `x-cron-key` / `?key=`); no user-agent bypass, and it answers 503 on production when unset |

Session lifecycle: a scan creates **no** session — it raises a code. The first correct code entry
starts the visit; every phone that enters the same code joins that visit with its own device token
and guest number, so several guests share one cart. The visit ends when the waiter closes the table,
after 90 minutes without activity, or at the 4-hour hard cap. Closing a table kills every device
token *and* every live code on it, and auto-rejects orders nobody confirmed.

**About a photographed QR:** a photo of the sticker is a valid table link — that is what a scan is —
but it is no longer *access*. Holding the photo gets you a code card on the waiter's screen, nothing
else: no session, no menu writes, no Wi-Fi password, and the code is read out in person at the
table. Delete the card (**Dismiss**) if nobody is standing there; use **New code** to replace one
that was overheard; use **New party** when the guests in front of you are new people and the old
visit is still open. **Admin → Settings → End all sessions and codes** is the panic button.

---

## 7. Feature walkthrough

### Guest (`/t/{table_code}`)
* Home: restaurant logo, table number, four cards — **View Menu, Leave a Review, Connect to
  Wi-Fi, Play Games**. Every action is two taps from home.
* Menu: categories, search, veg/non-veg marks, spice level, photos, original price struck through
  next to the offer price, sold-out items greyed out and not addable, floating **Call waiter** and
  **Request bill** buttons, shared-cart sheet showing "Guest 1 / Guest 2 · added by".
* After sending: **Your order** shows what was ordered, batch by batch (no live status stages; only a rejected order is flagged, with the waiter's reason).
  Guests can add more items later; each send is a new batch on the same session.
* Review: 4–5 stars → Google review button; 1–3 stars → private feedback form (owner only).
  One review per session.
* Wi-Fi: SSID, copy-password button and a server-rendered `WIFI:` QR that joins automatically.
* Games: solo, play with my table, or the whole-restaurant round with a countdown, plus today's
  leaderboard and prizes.

### Waiter (`/waiter`)
Colour-coded table grid (free / occupied / order pending / call active / bill requested), live
pending-order cards with confirm + reject-with-reason, live call and bill list, table detail with
orders, "close session" and "mark call handled". Sound + vibration per event, Web Push for the
backgrounded app.

### Kitchen (`/kitchen`)
High-contrast cards with table number, items, notes and time since confirmation; colour warnings
at 12 and 20 minutes; one **Done** button per order (it tells the waiter the food is ready and clears the card); newest confirmed first.

### Admin (`/admin`)
Overview (revenue, floor map, top items, hourly chart) · Menu & offers (categories, items, offer
price with optional time window, one-tap sold-out) · Tables & QR (create, regenerate code,
download the printable PDF) · Staff (create, role, disable, delete, reset password) · Reports
(date range, top items, hourly/daily/table breakdowns, CSV export) · Games (categories,
questions, CSV import, prizes, today's board) · Feedback inbox · Settings (brand, Wi-Fi, review
link, socials, tax/service charge, sounds, game rules).

---

## 8. Roles and accounts

| Role | Lands on | Can |
| --- | --- | --- |
| Guest | `/t/{code}` | Order, call waiter, request bill, review, Wi-Fi, games |
| Waiter | `/waiter` | See tables and calls, confirm/reject orders, close sessions |
| Kitchen | `/kitchen` | See confirmed orders, press Done when the food is made |
| Admin | `/admin` | Everything, including staff, menu, prices, reports, settings |

Demo accounts (created by `/setup` or `npm run seed:staff`, password `Demo@1234`):
`admin@spiceroute.test`, `waiter@spiceroute.test`, `kitchen@spiceroute.test`.

Install the staff screens as PWAs: open `/waiter` or `/kitchen` on the phone → **Share → Add to
Home Screen**. Tap **Enable sound** once — browsers block audio until a tap. On iPhone, Web Push
only works after the app is added to the home screen; the UI says so.

---

## 9. Printing QR codes and writing NFC tags

* **Admin → Tables → Download printable QR sheet (PDF)** produces an A4 sheet, 6 cards per page,
  high error-correction QR codes, with the raw URL printed for NFC writing.
* CLI equivalent (works without the app running):
  ```bash
  NEXT_PUBLIC_APP_URL=https://your-domain.com npm run qr:pdf
  DATABASE_URL=postgres://… npm run qr:pdf        # or PGLITE_DIR=.pglite
  ```
  Output: `public/table-qr-codes.pdf`.
* **NFC tags**: buy NTAG213 stickers (a few rupees each), install **NFC21 / NFC Tools**, write a
  *URL record* with `https://your-domain.com/t/{table_code}`. Print the QR on the same sticker so
  guests with older phones can scan instead.
* If a code leaks (someone photographs a sticker and orders from outside), open **Admin → Tables →
  regenerate**. The old URL dies immediately and open sessions on that table are closed.

---

## 10. Cost & deployment

| Item | Cost |
| --- | --- |
| Supabase free plan | ₹0 — pauses after a week of inactivity |
| Cloudflare Pages free | ₹0 — commercial use allowed |
| Vercel Hobby | ₹0 — **non-commercial only** |
| Domain | ~₹800–1,000 / year (the only paid item to look professional) |
| NFC stickers | a few rupees each; QR codes are free |
| Web Push | ₹0 (VAPID, no service) |

When a restaurant starts paying: move that project to a paid Supabase plan (about **$25/month**)
so it does not pause, and keep Cloudflare Pages free. One paid Supabase project can serve several
restaurants because the data model is multi-tenant. Verify current limits and prices before
launch — providers change them.

---

## 11. Backups

Supabase free plan has **no automatic daily backups**, so the README requires one:

1. **Nightly logical backup** (free, cron-friendly):
   ```bash
   pg_dump "$DATABASE_URL" --no-owner --no-privileges \
     | gzip > "backup-$(date +%F).sql.gz"
   ```
   Schedule it on any always-on machine (a ₹0 GitHub Action on a schedule also works) and push
   the file to a private bucket (Supabase Storage / Backblaze / Google Drive).
2. **Weekly restore drill**: restore the latest dump into a scratch database
   (`createdb scratch && gunzip -c backup-2026-10-01.sql.gz | psql scratch`) and confirm the row
   counts.
3. **Keep 30 days** of dailies and one monthly dump.
4. **Before every menu rewrite or price change**, take an on-demand dump — the audit log explains
   *what* changed, the dump lets you roll it back.
5. On a paid Supabase plan, enable **Point-in-Time Recovery** and keep the logical backups anyway.

Store backups outside the repo (they contain personal data: feedback contact details).

---

## 12. Testing

```bash
npm run typecheck                          # TypeScript, zero errors
npm run lint                               # ESLint, zero warnings
npm run test:smoke                         # 119 API checks against a running server
npm run test:security                      # 44 checks: hardening, P0 rules, admin lockout
npm run test:qa                            # 127 checks, sections A–L: the full product audit
npm run test:edge                          # 62 checks, 12 real-service situations (see below)
npm run test:e2e -- <table_code>           # Playwright, 15 steps: code screen → staff card → code
                                           # entry → order → re-order without a code → second
                                           # phone → close → table quiz → New party
```

Every script resets the demo database first, so they pass on repeat runs. Together they are
**352 passing checks, 0 failing** on a fresh `.pglite` and a clean `next build`.

`test:edge` is the awkward-stuff suite: a party of 14 on one table (12 phones, then a clear 409),
a photographed sticker used by someone outside, a guest who loses their phone mid-meal, both visit
clocks (90-minute idle window, 4-hour hard cap), a code that expires while the guest is typing, the
last order of the night on a table the waiter is closing, stickers swapped mid-service, two waiters
racing one order, an admin trying to demote or disable himself, hostile input, what the kitchen must
never see, and end-of-night cleanup. Any test that needs time to pass moves it through
`POST /api/dev/clock` — a dev-only route that 404s on a real Postgres, because PGlite is
single-writer per process and a second database handle from a test process sees a stale snapshot.
`test:security` covers: the production secret guard, cron auth (including a spoofed `vercel-cron`
user-agent), the scan rate limit, the device cap at *code entry* (the 13th phone gets a 409),
Wi-Fi password gating, atomic Confirm/Reject, batch-number uniqueness, and the table-code rules — a
scan sets no cookie, the code never appears in a customer payload, the kitchen never sees codes, the
same code admits a second phone, the 5th wrong try locks it, a locked code refuses the correct
digits, phones already inside survive a dead code, junk/cross-origin input never consumes an attempt,
guests cannot read or raise codes, and closing a table kills both the codes and the devices.

The smoke test walks the real HTTP surface: guest scan → cart → order → waiter confirm →
kitchen preparing/ready → guest sees "ready", waiter call cooldown, review-once rule, XSS
stripping, admin menu CRUD, offer validation, report generation, audit log, then the security
cases (anonymous/waiter/kitchen blocked from admin, cross-origin POST blocked, closed session
invalidating the token) and games (no answers leaked, duplicate answer rejected).

Per-phase manual checklists, the table-code P0/P1 list and the manual phone checks:
[`docs/testing.md`](docs/testing.md). Deep dives on the two clocks and the code/verify flow:
[`docs/architecture.md`](docs/architecture.md). For the floor team, print
[`docs/staff-guide.md`](docs/staff-guide.md).

---

## 13. Ops checklist for a live restaurant

**Deployment (do these before the first guest scans)**
- [ ] `SESSION_SECRET` set to ≥ 32 random characters in the host's env vars — `openssl rand -base64 48`.
      Missing or weak means staff sign-in fails with "Something went wrong" **on purpose**; the server
      log says `SESSION_SECRET is missing or too weak for production`.
- [ ] `CRON_SECRET` set, and the scheduler sends it (`Authorization: Bearer …` or `x-cron-key`). Without
      it `/api/cron/housekeeping` answers 503 and stale sessions never expire.
- [ ] `DATABASE_URL` set (Supabase/Postgres). Without it the app falls back to the in-memory demo database; the server log then says `running on the embedded database in production`.
- [ ] `DEMO_MODE` unset or `off` on the live deployment. Run `npm run build && npm run test:prod` once: it checks that production will not boot without `DATABASE_URL` and that `/api/setup`, `/api/demo/*` and `/api/dev/clock` are closed on a real database.
- [ ] Create the first real admin from the Supabase dashboard / `npm run seed:staff` (never keep the `@spiceroute.test` demo accounts on a live site).
- [ ] `NEXT_PUBLIC_APP_URL` set to the real domain *before* generating `public/table-qr-codes.pdf`.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` present in the server env only (never `NEXT_PUBLIC_`).
- [ ] `npm run test:security` run once against the deployed URL.

**Before opening**
- [ ] Real menu, prices and offers entered; sold-out items toggled correctly
- [ ] Tables match the floor; QR sheet printed and stuck down; NFC tested on both Android and iPhone
- [ ] Waiter + kitchen PWAs installed, sound enabled, push enabled, screens set to never sleep
- [ ] Staff accounts created, demo accounts disabled
- [ ] Google review link tested from a phone (it must open the review box, not the listing)
- [ ] Wi-Fi card tested on both platforms
- [ ] Tax/service charge set; one test order end-to-end with the real printer/counter flow
- [ ] Nightly backup scheduled **and one restore verified**

**Daily**
- [ ] Kitchen screen open on a charged tablet before service
- [ ] Sold-out items toggled as the kitchen runs out
- [ ] Private feedback reviewed (Admin → Feedback)
- [ ] Check today's leaderboard winner gets the prize

**Weekly**
- [ ] Backup file exists and is non-trivial in size
- [ ] Audit log skimmed for unexpected price/staff changes
- [ ] Session housekeeping cron healthy (`/api/cron/housekeeping`)
- [ ] Quiz bank topped up so regulars do not see repeats

---

## 14. Project structure

```
middleware.ts                  table-session bootstrap for /t/{code} (must stay at the root)
app/
  page.tsx                     landing + demo entry
  setup/                       setup & demo data screen
  staff/login/                 staff sign-in
  t/[code]/                    guest experience
    page.tsx                   four-card home (NFC/QR landing)
    menu/  status/  review/  wifi/
    games/                     lobby, round/[roundId], results/[roundId]
  waiter/  kitchen/            staff PWAs
  admin/                       overview, menu, tables, staff, reports,
                               games, feedback, settings
  api/
    public/[action]/           customer endpoints (session, state, menu, cart, order, call, review, feedback)
    public/games/[action]/     quiz lobby/round/results/leaderboard/start/join/answer
    waiter/[action]/           board, table, order confirm/reject, call handled, close session
    kitchen/[action]/          board, preparing/ready
    admin/[action]/            menu, tables, staff, settings, reports, games, feedback, audit
    admin/qr-pdf/              printable QR sheet
    staff/                     login, logout, me, events (poll fingerprint), push
    demo/seed/                 one-click demo staff + demo table link
    demo/reset/                wipe a demo database back to seed state (test helper)
    cron/housekeeping/         session expiry, table freeing, rate-limit pruning
src/
  server/                      db, auth, session, repos/*, api helpers, events (realtime+push)
  components/                  customer/*, staff/*, admin/*, ui/* (shadcn-style primitives)
  lib/                         validation (Zod), i18n (en/hi), sounds, crypto, sanitize, utils
supabase/
  migrations/                  0000…0005 (0005 = concurrency hardening)
  seed/                        demo restaurant, menu, quiz
scripts/
  ensure-secret.mjs            generates SESSION_SECRET into .env.local for local dev
  seed-staff.mjs               demo staff accounts (Supabase or local)
  security-test.mjs            17 regression checks for the pre-launch review findings
  smoke-test.mjs               63-check end-to-end test
  generate-qr-pdf.mjs          printable QR sheet
docs/
  testing.md                   per-phase test checklists
  architecture.md              deeper notes: sessions, realtime, games scoring
```

---

## 15. Roadmap / known limits

* **Payments.** No gateway in v1 by design — the bill is settled at the counter/table as usual.
  The order total already carries tax and service charge so a gateway can be added later.
* **Happy-hour rules.** Items support `offer_price` with a start/end window (that is the
  Happy-Hour primitive). Multiple rules per category are the natural next step.
* **Images.** Menu images are URLs (Supabase Storage bucket `menu-images`, ≤200 KB WebP is
  configured). The admin UI takes URLs today; a drag-and-drop uploader with client-side WebP
  compression is the next increment.
* **i18n.** English + Hindi labels with a one-tap switcher on the guest page; adding a third
  language is a new entry in `src/lib/i18n.ts`.
* **Offline.** The guest page shows an offline notice and retries; the staff screens cache their
  shell. A true offline order queue is intentionally out of scope (an order must be confirmed by
  a waiter).
* **Multi-tenant UI.** The data model and RLS serve several restaurants from one project; there
  is no self-serve "create restaurant" flow yet (create the row and staff accounts manually).

---

*Deliverables from the spec: source code (this repo), SQL migrations + seed, `.env.example` and
this README, printable table QR PDF, and per-phase test checklists.*
