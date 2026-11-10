# Test checklists — phase by phase

Layers:

* **Automated API** — `npm run test:smoke` (119 checks, real HTTP, real database).
* **Automated security** — `npm run test:security` (44 checks: the pre-launch review — production
  secret guard, cron auth incl. a spoofed `vercel-cron` UA, scan rate limit, device cap at code
  entry, Wi-Fi password gating, atomic Confirm/Reject, unique batch numbers, the last-admin
  lockout guards, the test-only clock — plus the table-code P0 rules listed below).
* **Automated full audit** — `npm run test:qa` (127 checks, sections A–L: every guest, waiter,
  kitchen, admin, games, reporting, ops and abuse path).
* **Automated edge cases** — `npm run test:edge` (62 checks, 12 real-service situations: a party
  of 14, a photographed sticker, a lost phone, both visit clocks, a code that expires mid-typing,
  the last order of the night, a mid-service sticker swap, two waiters racing, an admin locked out,
  hostile input, kitchen privacy, end of night).
* **Automated browser** — `npm run test:e2e -- <table_code>` (Playwright, 15 steps, full guest→staff loop).
* **Manual** — the checklists below, written for a phone + a laptop on the same network.

Prep for every run:

Two front doors — both are supported, pick one:

```bash
npm start                          # production build + embedded Postgres (.pglite)
npm run dev                        # http://localhost:3000
# in another terminal / on the phone use the LAN IP: http://<laptop-ip>:3000
curl -X POST localhost:3000/api/setup      # (re)create demo staff logins
curl -X POST localhost:3000/api/demo/reset # wipe demo orders/sessions back to seed state
```

`test:qa`, `test:edge` and `test:e2e` all call `/api/demo/reset` themselves, so run them against the
**embedded demo database** (`npm start` / `npm run dev`, `dbMode === 'pglite'`). That route — and
`/api/dev/clock`, which `test:edge` uses to move time — answers 403/404 on a real Postgres, by
design: a live restaurant can never be wiped or have its clock moved through the app.

> PGlite is single-writer **per process**. Never open a second `new PGlite('.pglite')` from a test
> process: it sees a different snapshot, so "delete the row and check" style tests silently lie.
> That is exactly why `/api/dev/clock` exists — the clock is moved from inside the server.

Demo codes you will need:

| Account | Email | Password |
| --- | --- | --- |
| Admin | admin@spiceroute.test | Demo@1234 |
| Waiter | waiter@spiceroute.test | Demo@1234 |
| Kitchen | kitchen@spiceroute.test | Demo@1234 |

Get a table link: sign in as admin → **Admin → Tables → Copy link** on Table 1.
**The code itself is never in the link** — read it from the waiter board (`/waiter`, "Table codes").

---

## Phase 1 — MVP

### Table session
- [ ] Opening `/t/{code}` shows the restaurant name, table number and four cards.
- [ ] The URL contains a long random code, never the table number.
- [ ] DevTools → Application → Cookies: `tt_session` is **HttpOnly** (not readable from JS).
- [ ] A second phone opening the same link shows a different guest number but the same cart.
- [ ] Opening the link in a private window creates a *new* session and the first phone keeps working.
- [ ] Restarting the server / waiting 3 h and reloading shows the "session ended, scan again" screen.

### Menu
- [ ] Categories, search, veg filter and item photos render.
- [ ] An item with an active offer shows the old price struck through and the new price.
- [ ] An expired offer (`offer_end` in the past) shows only the normal price.
- [ ] Sold-out items are greyed out, show "Sold out" and cannot be added.
- [ ] Tapping an item opens the detail sheet with quantity and a notes field.

### Shared cart
- [ ] Guest A adds 2× Paneer Tikka; Guest B's screen shows it within ~5 s with "Guest 1".
- [ ] Guest B edits the quantity; Guest A sees the change.
- [ ] Removing the last unit removes the line.

### Send order → waiter → kitchen
- [ ] Tap Send order: cart empties, guest sees status **Waiting for waiter**.
- [ ] Waiter board shows the order with a sound (after "Enable sound"); kitchen board does **not**.
- [ ] Waiter **Confirm** → the order appears on the kitchen screen with a different sound.
- [ ] Waiter **Reject** without a reason is blocked; with a reason the guest sees it.
- [ ] Kitchen **Start preparing** → **Mark ready**; the guest status matches each step.
- [ ] Invalid transitions are refused (e.g. Ready → Preparing).

### Staff login and roles
- [ ] `/staff/login` with a wrong password shows a clear error and is rate limited after 8 tries.
- [ ] Waiter login lands on `/waiter`; kitchen on `/kitchen`; admin on `/admin`.
- [ ] Kitchen cannot open `/waiter` (redirect) and `/api/waiter/board` returns 403.
- [ ] Waiter cannot open `/admin` and `/api/admin/menu` returns 403.
- [ ] Signing out returns to `/staff/login` and the cookie is gone.

### Admin menu management
- [ ] Create a category, create an item inside it, edit it, delete it.
- [ ] An offer price above the normal price is rejected with a message.
- [ ] Price/offer edits appear on the guest menu after a refresh.
- [ ] Every one of those actions appears in **Admin → audit** (if you added the audit screen) or
      in the `audit_log` table.

---

## Phase 2 — Calls, sounds, tables, offers, reports, PWA

### Call waiter / request bill
- [ ] **Call waiter** shows a confirmation toast; the waiter board shows an orange call card.
- [ ] Tapping it again within 30 s is blocked with a cooldown message.
- [ ] **Request bill** shows a separate magenta card with a different sound.
- [ ] Waiter taps **Done** → the card disappears on every staff device.
- [ ] Customers see the calls as "handled" (no stale action buttons).

### Sounds
- [ ] First load of the waiter board shows the **Enable sound** bar; tapping it plays a chime.
- [ ] New order, waiter call, bill request and order-ready each play a *different* sound.
- [ ] Admin → Settings → change a sound → **Test** plays the new one; the next real event uses it.
- [ ] Sounds do not play before the first tap (browser policy) — the banner stays visible.

### Table grid
- [ ] Free tables are neutral, seated tables blue, pending orders amber, calls orange, bills magenta.
- [ ] Tapping a table opens its session, orders and actions.
- [ ] **Close session** frees the table and the guest phone shows "scan again".

### Offers & sold-out
- [ ] Sold-out toggle from admin takes effect on the guest menu within one refresh.
- [ ] Turning it back on restores the item.
- [ ] A time-windowed offer activates and deactivates at the right time (edit the window to
      something 1 minute in the future to test).

### Reports
- [ ] **Admin → Reports** shows revenue, orders, average order, rejected count for today.
- [ ] Date range filters work; 7-day and 30-day shortcuts load.
- [ ] Top items, hourly chart, daily totals and top tables match the orders you placed.
- [ ] CSV export downloads and opens correctly in Excel/Sheets.

### PWA + Web Push
- [ ] On Android Chrome, `/waiter` offers "Add to Home Screen" and opens standalone.
- [ ] On iPhone Safari, Share → Add to Home Screen installs it.
- [ ] **Enable push alerts** grants permission and the subscription appears in
      `push_subscriptions`.
- [ ] Lock the phone, place an order as a guest → a notification arrives and opens `/waiter`.
- [ ] On iPhone, push works only after installing — the UI explains this.

---

## Phase 3 — Wi-Fi, reviews, live status

### Wi-Fi
- [ ] The Wi-Fi card shows the SSID from Admin → Settings.
- [ ] **Copy password** copies it (paste somewhere to confirm) and shows "Copied".
- [ ] The QR code joins the network on iOS 11+ and Android 10+ (test on a real phone).
- [ ] Changing the SSID/password in admin changes the guest card on refresh.

### Review routing
- [ ] Rating 4–5 shows the **Share it on Google** button, which opens the configured review link.
- [ ] Rating 1–3 shows the private feedback form instead — no Google button anywhere.
- [ ] Submitting appears in **Admin → Feedback** including the table number and contact.
- [ ] A second review from the same session is refused.
- [ ] A review containing `<script>` is stored and displayed without executing it.

### Live status
- [ ] The status page shows one card per batch with a four-step tracker.
- [ ] Steps advance automatically as the waiter/kitchen act, without a manual refresh.
- [ ] Adding items after the first order creates **Batch #2** on the same session.
- [ ] The unsent-cart block appears when items are added but not sent.

---

## Phase 4 — Quiz: solo and table

### Solo
- [ ] Lobby → **Solo** starts a 10-question round immediately.
- [ ] The timer counts down; running out submits an answer and shows the correct one.
- [ ] After each answer the explanation appears, never before.
- [ ] After question 10 the results screen shows score, correct count and every explanation.
- [ ] Playing a second round in the same session avoids questions already answered.

### Play with my table
- [ ] Guest A starts a table round → a lobby appears with a countdown.
- [ ] Guest B on the same table joins by starting the same mode and appears in the lobby.
- [ ] Everyone gets the same 10 questions in the same order.
- [ ] Rankings inside the table are correct, with the faster player ahead on ties.

### Question bank
- [ ] **Admin → Games → Add** creates a question with four options and one correct answer.
- [ ] Editing the correct answer changes the scoring behaviour.
- [ ] **CSV import** with the template adds questions; a bad row is reported with its line number.
- [ ] Importing 40+ questions and starting a round still picks 10 distinct ones.

### Anti-cheat
- [ ] DevTools → Network → an answer request: the response contains `isCorrect`, `correctIndex`
      and the explanation **only after** answering.
- [ ] `/api/public/games/round` never contains `correctIndex` and never contains `explanation`
      for unanswered questions.
- [ ] Answering the same question twice is rejected (409).
- [ ] Submitting a fake fast time does not beat the wall clock (score stays realistic).

---

## Phase 5 — Whole restaurant rounds

- [ ] The games lobby shows a countdown to the next public round (default every 5 minutes).
- [ ] Two different tables can join the same round before it starts.
- [ ] When the countdown hits zero everyone's round starts with the same questions.
- [ ] After finishing, the results screen lists all players and the per-table ranking.
- [ ] **Today's leaderboard** shows table points (sum by default, switchable to average in
      Settings) and the prize for each rank.
- [ ] Admin → Games → today's board matches, and prizes can be added/edited/deleted.
- [ ] The leaderboard only counts `restaurant` mode rounds and resets at midnight IST.
- [ ] Joining a round that already finished is refused with a clear message.

---

## Waiter table codes (OTP) — P0/P1

Codes live on the **waiter board** (`/waiter`) and in the push notification. They must never appear
on a guest screen, in a URL, in page source or in a log.

### P0 — automated (`npm run test:smoke` + `npm run test:security`)

| # | Rule | Where |
| --- | --- | --- |
| 1 | A scan creates **no** session and sets **no** cookie | smoke "scan creates NO session", security 3 |
| 2 | The scan/state payload contains no code and no Wi-Fi password | smoke "scan response carries no code", security 7 |
| 3 | A code exists only on the staff API; the kitchen role never receives one | smoke "kitchen never receives codes", security 7 |
| 4 | One live code per table; a repeat scan reuses it | smoke "one live code per table" |
| 5 | The same code admits a second phone, which joins the same visit | smoke "same code lets a second phone in", security 7 |
| 6 | A wrong code reports the attempts left; non-digits never count | smoke "letters are rejected…", security 7 |
| 7 | The 5th wrong try locks the code; the correct code then fails | smoke "5th wrong try locks the code", security 7 |
| 8 | Phones already inside keep working when a code dies | smoke "a new code does not kick out phones…", security 7 |
| 9 | Dismiss kills the code for every screen | smoke "waiter can dismiss a code" |
| 10 | "New code" ignores the cooldown and kills the old code | smoke "the replaced code is dead immediately" |
| 11 | Closing the table kills the codes **and** the devices | smoke "closing the table kills its live code", security 7 |
| 12 | A closed table cannot order | smoke "a closed table cannot order" |
| 13 | The 13th phone on one table gets a 409 | security 3 |
| 14 | Cross-origin code entry is refused; guests cannot read or raise codes | security 7 |
| 15 | Out-of-range settings are rejected; valid ones save | smoke "Table code settings" |
| 16 | Panic action ends every session and every code | smoke "admin can end all sessions and codes" |
| 17 | Cron prunes codes and closes stale sessions | smoke "cron housekeeping runs" |
| 18 | **"New party" works for the waiter role** over POST `/api/waiter/new-party` (and for admin over POST), signs the old visit out, and is refused for kitchen | smoke "waiter can start a new party" |
| 19 | **A table round is answerable the moment its lobby ends** — the stored status becomes `active`, not just the view | smoke "an answer right after the start is accepted" |

### P1 — automated browser (`npm run test:e2e -- <table_code>`)

| # | Step | Expected |
| --- | --- | --- |
| 1 | Open `/t/{code}` cold | "Enter your table code", no cookies set |
| 2 | Open `/t/{code}/menu` before verifying | Menu renders with "Enter the table code to order" |
| 3 | Waiter board | "Table codes" card with a big live code |
| 4 | Type the code | Table home; the field auto-submits on the last digit |
| 5 | Add + send an order | Pending on the board, kitchen after confirm |
| 6 | Re-order without typing the code again | Works |
| 7 | Second browser context, same code | Joins the same visit |
| 8 | Waiter closes the table | Both phones land back on the code screen |
| 9 | Play with my table → wait out the 25 s lobby → answer question 1 | The answer is accepted (200), never "the round has not started yet" |
| 10 | Waiter board → **New party** | 200 from `/api/waiter/new-party`; the route is not admin-only |

### P1 — manual (phone + laptop)

- [ ] Code box opens the **numeric** keypad (`inputmode=numeric`) and accepts a paste of 4 digits.
- [ ] Wrong code: field clears, "That code is not right. N left." — the same N appears on the
      waiter's card ("N tries left").
- [ ] After the 5th wrong try: "Too many wrong attempts…" and the card shows "Locked after 5 wrong
      tries" (it stays on the board for 5 minutes).
- [ ] "Ask again" is disabled with a countdown for the first 60 s, then raises a fresh card.
- [ ] Switch the phone to Hindi (हिं button on the code screen) — every code-screen string translates.
- [ ] Code card turns red after 2 minutes; the admin alert is visible after 5.
- [ ] The code-request sound is clearly different from the order chime.
- [ ] Kill the waiter app (no device polling for 60 s), then scan: the guest sees "No staff device is
      online. Please call a staff member." and a tap-to-call number.
- [ ] Open the link inside Instagram/Facebook's in-app browser → cookie notice appears.
- [ ] Waiter board, table with an open visit + a new scan: the card warns "A visit is still open" and
      offers **Same party** (read the code) / **New party** (end it).
- [ ] Kitchen screen: no code card, no code in the event payload while codes are being raised.
- [ ] Admin → Settings: change the code length to 6 → guests get six boxes; set it back to 4.
- [ ] Admin → Settings → **End all sessions and codes** → every table goes Free, guests must re-enter.

---

## Security regression (run before every client demo)

- [ ] `curl localhost:3000/api/admin/menu` without a cookie → 401.
- [ ] Same with a waiter cookie → 403.
- [ ] `curl -X POST` with `Origin: https://evil.example` → 403 (cross-origin blocked).
- [ ] `/api/public/state?t={code}` without a cookie → 200 with `needs_code: true` and an empty
      session id (the code screen), and every write endpoint on it → 401.
- [ ] A customer response never contains the table code (`grep` the JSON for the digits).
- [ ] An unknown table code → 404 page, never a stack trace.
- [ ] Sending `{ "price": 0.01 }` with an order does not change the total (server recalculates).
- [ ] Closing the session invalidates a previously working cookie (copied QR can't be reused).
- [ ] `SELECT` on any table with the anon key fails (RLS + no grants).
- [ ] Response headers include CSP, HSTS, X-Frame-Options DENY, nosniff.
- [ ] No `SUPABASE_SERVICE_ROLE_KEY` value appears anywhere in the browser bundle
      (`grep -r "service_role" .next/static`).

---

## Hardening checks (run once before handing over)

These mirror `npm run test:security`, but by hand — useful when you want to see the failure modes.

| # | Check | Expected |
| --- | --- | --- |
| 1 | Deploy with `SESSION_SECRET` unset, then sign in as admin | Error toast "Something went wrong"; server log says `SESSION_SECRET is missing or too weak for production`; **no** `tt_staff` cookie is set |
| 2 | Deploy with `SESSION_SECRET=short` | Same refusal |
| 3 | Sign in with a 32+ char secret | Works; cookie is `HttpOnly`, `Secure`, `SameSite=Lax` |
| 4 | `curl -X GET /api/cron/housekeeping` with no key | 403 (or 503 when `CRON_SECRET` is unset on production) |
| 5 | Same call with `-H 'user-agent: vercel-cron'` | Still 403 — the UA is not a credential |
| 6 | Same call with `-H 'authorization: Bearer <CRON_SECRET>'` | 200 with `{ ok: true, data: { prunedRateLimits } }` |
| 7 | Scan one table 130× quickly from the same IP | First 120 accepted, then 429 with `retry-after` (the window is 120/10 min — a whole restaurant shares one IP) |
| 8 | Enter the same code from 13 phones | First 12 join; the 13th returns 409 "This table already has 12 phones connected" |
| 9 | `POST /api/public/session` and inspect the JSON | No code, `settings.wifi_password` is `null`, `needs_code: true` |
| 10 | `GET /api/public/state?t=<code>` | No `wifi_password` key at all |
| 11 | `POST /api/public/wifi` **with** a session cookie | Returns the password |
| 12 | `POST /api/public/wifi` **without** a cookie | 401 |
| 13 | Two waiters tap Confirm on the same order at the same moment | One gets success, the other "Another staff member already updated this order" (409); the order is confirmed once |
| 14 | Send two orders from two phones simultaneously | `Batch #1` and `Batch #2` — never two of the same number |
| 15 | Waiter ticket for a pending order | Shows "table open <time> · N phones", so a table nobody was seated at stands out |

## Operational reactions

| Situation | What to do |
| --- | --- |
| Photographed QR being abused | Waiter board → table → **Close session** (kills every device token *and* the live code), then **Admin → Tables → Regenerate code** and reprint that sticker |
| A code was overheard | Waiter board → the card → **New code**. Phones already inside keep working |
| Guests wait too long for a code | The card turns red after 2 min and the manager is alerted after 5. Check the board is on a screen someone actually watches |
| Suspected leak, closing time, device stolen | Admin → Settings → **End all sessions and codes** |
| Guest says "it says the table is full" | The 12-phone cap was hit (usually a big group, or abuse). Close the session and ask them to scan again |
| Guests on shared restaurant Wi-Fi hit "Too many scans" | 120/10 min per IP is reached on a very busy night — raise `SCAN_RATE_LIMIT` in `src/lib/constants.ts`. The real limiter is the per-code 5 attempts |
| A guest's visit ended while they were still eating | Raise **idle timeout** (default 90 min) or the hard cap (4 h) in Admin → Settings → Table codes & sessions |
| Cron job silently not running | Check `CRON_SECRET` matches on both sides; `/api/cron/housekeeping` returns 503 when the server has no secret |


## Production gates (`npm run test:prod`)

Run after `npm run build`. It starts `next start` three times (embedded DB with `DEMO_MODE` unset, `DEMO_MODE=off`, `DEMO_MODE=on`) and checks that `/api/setup`, `/api/demo/seed`, `/api/demo/reset`, `/api/dev/clock` and the `/setup` page are closed in production unless demo mode is switched on explicitly, and that no demo login can be created. This is the regression test for the unauthenticated `/api/setup` hole.


## Games on the server clock (`npm run test:games`)

63 checks, run on the embedded demo database with the dev clock: 25 s lobby · 15 s per question · same
question for everybody · only the question on screen is sent · no joining after the start (table and
restaurant) · restaurant joining closes 25 s early · answers only inside their own window · no points, verdict
or correct option while playing · results only at the end · faster = more (about 148 at 0.4 s, about 109 at 12 s)
· quitting is final · a table scores a question only when all its players are right, and gets the average ·
a quitter is left out from the question they quit on · solo unchanged.

Manual (two phones at one table, a third elsewhere): tap **Play with my table** on phone A; phone B's Games
page shows *Your table started a game … tap to join* for 25 s; B joins; both read the rules; question 1 appears
on both at the same second; answer on A and watch B get no hint; try to join with a third phone after the start.


## Prizes on/off (part of `npm run test:games`)

Admin → Games → *Leaderboard prizes* has a master switch, **Show prizes to guests** (default OFF), and each prize
has an **Active** switch. Guests see a prize on the Games page leaderboard only when the master switch is on AND
that prize is active. Turning the switch off deletes nothing. Checked: starts OFF · guests see no prize · a waiter
cannot flip it · ON shows exactly the prizes set for each rank · a hidden prize stays hidden even with the switch ON ·
saving a prize again never leaves a second copy of that rank (it used to) · OFF again hides everything and keeps the data.


## Restaurant game started by the admin (part of `npm run test:games`, 115 checks in all)

Nothing runs by itself (no banner, joining refused) · only an admin can Start (waiter and guest phones are refused) ·
a second Start while one is on is refused · banner on every phone with the join phase · 60 s to join + 25 s of rules ·
a game with only one table cancels itself and the admin reads "not enough teams" · the waiting player is told it was
cancelled · the admin can cancel before the start · max 2 phones per table (a third is refused; a quit frees the seat; the
quitter cannot return) · nobody new joins a running match; a reload gets the same seat back · the admin sees the match, the
winner, the players' names and the prize for the rank (also while guests are not shown prizes) · *Prize given* tick and untick
(admin only).

Manual (admin + 3 phones at 3 different tables): press **Start restaurant game**; the banner appears on the phones within ~4 s;
join with two phones at one table and see the third refused; after 60 s the rules screen with a 25 s countdown; the match starts
on all phones at the same second; the admin screen shows the tables that joined and the question number; afterwards the winner card.
