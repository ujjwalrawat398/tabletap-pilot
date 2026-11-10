# TableTap — final QA verdict

**Date:** 1 November 2026
**Build:** commit `8c8c071` on top of `72c2cc6` (table codes) + `977e2e8` (New party, table rounds)
**How it was run:** fresh `.pglite` (deleted, re-migrated), clean `npx next build`, `npm start`,
then all four suites plus the Playwright walkthrough against that one server.

---

## 1. The headline

**352 automated checks passed. 0 failed.**

| Suite | Checks | Result | What it covers |
| --- | --- | --- | --- |
| `npm run test:smoke` | 119 | ✅ 119 / 0 | Every API path: OTP, orders, games, cron, health |
| `npm run test:security` | 44 | ✅ 44 / 0 | 38 attack checks + 6 new lockout/clock checks |
| `npm run test:qa` | 127 | ✅ 127 / 0 | Sections A–L: full product audit |
| `npm run test:edge` | 62 | ✅ 62 / 0 | 12 real-world service situations |
| `npm run test:e2e` | 15 steps | ✅ all true | Real Chromium: guest phone + waiter + kitchen |
| `npx tsc --noEmit` | — | ✅ clean | |
| `npm run lint` | — | ✅ clean | |
| `npx next build` | — | ✅ exit 0 | |

The important part is not the number — it is that **four genuine bugs were found by these
suites during this QA pass and fixed**, not just reported. They are listed in §4.

---

## 2. What is OK — feature by feature

### Guest side
- **Scan → code screen.** Tapping the NFC tag or opening the table link sets **no cookie** and
  creates **no session**. The response contains no code and no Wi-Fi password. (smoke, security)
- **Menu preview** before the code, when the restaurant allows it; ordering stays blocked.
- **Code entry.** A 4-digit waiter-issued code admits the phone. Wrong codes report the attempts
  left. Non-digits are rejected without burning an attempt.
- **Lockout.** The 5th wrong try locks the code; **rotating IPs does not help** — the counter is
  per table code, not per IP. The waiter board shows the card as `locked`, and even the real
  guests cannot then use it until a new code is raised.
- **Second phone, same visit.** A partner scans and enters the same code and *joins* the same
  visit — G1, G2, … each phone gets its own guest number and its own credential. Correct code
  entered twice (double tap) is a success, not an error.
- **Device cap.** 13th phone gets a 409 with a plain-English message: *"This table already has 12
  phones connected. Ask a waiter to close the table session, then enter a new code."* When a phone
  leaves, the slot frees up and can be taken again.
- **Ordering.** Cart → order → waiter confirms → kitchen sees it → guest sees **Ready**. Re-ordering
  later needs no new code. Cart totals, notes, qty limits and ₹ formatting all correct.
- **Lost phone.** A new phone with the same live code gets back into the *same* visit; the earlier
  order is still listed and the sent cart lines do not resurrect.
- **Wi-Fi password** is returned only to a device holding a live session.
- **Visit clocks.** 90 minutes of silence ends the visit (`closed_reason = 'idle timeout'`);
  a busy table still dies at the 4-hour cap (`'hard cap reached'`); activity slides the idle clock
  but **never** the hard cap.
- **Games.** Solo round starts immediately; a table round shows a 25-second lobby then runs 10 questions of 15 s on the server's clock;
  a second phone at the same table joins that round; a phone at another table is refused 403; solo
  rounds cannot be joined; answers submitted before the start get 409.
- **Closing.** When the waiter closes the table the guest is sent back to the code screen, the
  unconfirmed order is rejected as "table closed", and it never reaches the kitchen or revenue.

### Staff side
- **Waiter board.** Live code cards with `live / locked / expired` state, phone count, guest
  numbers, table grid, pending orders, bill requests.
- **Waiter actions.** Raise a new code (instant, no cooldown), New party, confirm/reject an order,
  close a session. Two waiters racing the same Confirm → exactly one 200, one 409. Same for the
  kitchen starting a dish.
- **Kitchen screen.** Sees confirmed tickets only. **No code digits, no code cards, no phone
  counts** — verified by scanning the actual kitchen payloads.
- **Admin.** Menu CRUD, categories, tables (create/regenerate/delete), staff (create/role/disable/
  password), settings, reports, QR PDF (5 pages, ~214 kB), audit log, end-all-sessions panic button.
- **Lockout protection.** The last admin cannot be demoted **or** switched off, in any request shape.
- **Roles.** Kitchen cannot start a party or read codes; guests cannot read or raise codes;
  cross-origin code entry is refused.

### Ops & platform
- `/api/health` → `{"ok":true,"mode":"pglite"}`.
- Cron requires the secret (403 without it, including a spoofed `vercel-cron` user-agent) and
  housekeeping closes stale sessions, prunes codes and rate-limit buckets.
- CSP, HSTS, `nosniff` and frame denial present on responses.
- `POST /api/demo/reset` restores seed state; it refuses to run on a real Postgres.
- Sticker swap (admin regenerates a table code) kills the old link with 404, ends the visit and
  cuts off phones already at the table; the new sticker works immediately.

---

## 3. What is not OK, or not proven

Nothing known-broken remains. These are the honest limits of what was tested:

1. **PGlite, not Postgres.** Every run used the embedded database. The SQL is written for both
   (and `dbMode === 'pg'` paths exist), but a Supabase/Postgres deployment was **not** exercised.
   Two things change there: `dbMode` is `pg`, so `/api/demo/reset` and `/api/dev/clock` correctly
   return 403/404 — which also means `test:qa`, `test:edge` and `test:e2e` **cannot** run
   against a live database. They are demo-instance suites by design.
2. **No real payment, printer or KOT integration** — TableTap does not have one; nothing to test.
3. **Push notifications** are covered at the API level only; no test drives a real device
   subscription through a browser push service.
4. **Load.** The 12-phone cap and concurrent Confirm are tested; a genuine 200-phone dinner rush
   against Postgres was not simulated.
5. **Time zones.** Clocks were moved in the embedded DB (UTC). A restaurant whose timezone crosses
   a day boundary at closing time is not covered by a test.
6. **Safari iOS quirks** (cookie persistence in in-app browsers, NFC hand-off) are untested — the
   browser run is Chromium at a 390×844 viewport, not a physical iPhone.

---

## 4. Bugs this QA pass found and fixed

| # | Bug | Effect | Fix |
| --- | --- | --- | --- |
| 1 | `staff-update` last-admin guard used a ternary, so `{role:'admin', isActive:false}` (exactly what the UI toggle posts) skipped the `isActive` branch | **The only owner could disable himself and be permanently locked out of the admin panel** | Both branches checked independently (`8c8c071`) |
| 2 | `/api/demo/reset` inserted `staff_profiles` without `user_id`, which is `NOT NULL` | Route **500'd on any freshly migrated database**, so every suite that resets first could not run | Supply a uuid like `createStaffAccount()` does (`8c8c071`) |
| 3 | `POST /api/public/games/join` only matched `mode='restaurant'` | Second phone at a **table** round got 404 "That round no longer exists" | Look the round up regardless of mode; 403 for solo and foreign tables (`8c8c071`) |
| 4 | `updateCartQty` ran `set qty = 0` first, violating `cart_items_qty_check` | Minus button at qty 1 returned **500** | Route qty 0 to `removeCartItem` (`8c8c071`) |

Also fixed earlier in this cycle: waiter "New party" (`977e2e8`) and game round status not
advancing lobby → active → finished (`977e2e8`).

---

## 5. How to reproduce

```bash
rm -rf .pglite && npx next build && PGLITE_DIR=.pglite npm start

node scripts/smoke-test.mjs     # 119 / 0
node scripts/security-test.mjs  #  44 / 0
node scripts/final-qa.mjs       # 127 / 0
node scripts/edge-cases.mjs     #  62 / 0
node flow.mjs <table_code>      #  15 browser steps, all true
```

Notes for whoever runs this next:
- `edge-cases.mjs` moves time through `POST /api/dev/clock`, a dev-only route that exists for
  exactly this. Do **not** open a second `new PGlite('.pglite')` from a test process — PGlite is
  single-writer per process, so an outside handle sees a stale snapshot and "delete the row, then
  check" assertions silently lie. That trap cost an hour in this pass.
- Suites reset the demo DB themselves; run them against `npm start` or `npm run dev` with
  `PGLITE_DIR=.pglite`.

---

## 6. Verdict

**Ship it** for the demo/single-restaurant use it was built for: table codes, multi-device visits,
ordering, kitchen flow, admin, games, reporting and abuse handling all behave correctly under
normal use and under the awkward cases a real dinner service throws at them, and the four real
defects found in this pass are closed and regression-tested.

**Before a live paying restaurant**, do an hour of smoke testing on real Postgres/Supabase — that
is the one environment this audit could not reach — and re-run `test:smoke` and `test:security`
against it.
