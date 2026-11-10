# Architecture notes

Deeper explanations of the three pieces that are easy to get wrong: table sessions, the realtime
feed, and game scoring.

## 1. Table codes, sessions and devices

Two clocks and two secrets — that is the whole design:

* a **code** (4 digits, one live per table) that a waiter reads out in person, and
* a **session** (one visit) that starts when someone types that code correctly.

A scan on its own grants nothing. It validates the sticker, raises (or reuses) the code, and pings
the staff board.

```
QR / NFC  ──►  GET /t/{code}
                    │
                    ▼  middleware.ts   (routing only: no cookie is ever written here)
                    │
                    ├─ device cookie resolves to a live session?  → table home
                    └─ otherwise                                   → code screen
                                                                  + read-only menu (D2)

POST /api/public/session   (a scan, or "Ask again")
   ├─ live code for this table?           → reuse it, report the cooldown
   ├─ it expired / locked, cooldown over? → raise a new one
   └─ always                              → broadcast + push to the staff board
                                            response: NO code, NO Wi-Fi password

POST /api/public/verify-otp   (the guest types what the waiter said)
   ├─ consumeOtp()  one `select … for update` transaction:
   │     wrong digit  → attempts++ (each one), 5th wrong locks the code
   │     non-digit    → rejected by zod BEFORE the counter is touched
   │     locked/expired/missing → distinct machine-readable reason
   ├─ an open visit on this table?  → join it (new device token, next guest number)
   │  otherwise                    → createSession() (idle window + hard cap)
   ├─ issueDeviceToken(…, maxDevices)  → 13th phone gets a clear 409
   └─ attachOtpToSession()             → the board shows "N joined"
```

**Why the session is not minted in middleware any more.** It used to be: Next.js 15 forbids writing
cookies from a Server Component, so `middleware.ts` called `POST /api/public/session` for every
`/t/{code}` route. That made a scan equal to access — a photographed sticker was a valid session.
Now the cookie is written by the **route handler** that verified a code (a route handler may set
cookies), and the middleware does nothing but send cookie-less guests of a sub-page back to the
landing page.

**Why the code is compared inside one statement.** `consumeOtp()` selects the live row
`for update`, so two phones typing two guesses at the same millisecond are serialised: each one
counts, and the fifth locks the code. Counting in application code would let 20 parallel guesses
through the 5-try window.

* Only `sha256(token)` is stored (`table_sessions.token_hash`, `table_session_devices.token_hash`).
* The raw token lives in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie.
* The guest number comes from the device-token row, **not** from anything the browser can edit.
* Codes are plain text in `table_otps` (the waiter has to read them), are never logged, never
  audited and are deleted by the cron job after 24 hours.
* Waiter **close session** deletes the device rows, sets `closed_at`, kills the table's live code,
  auto-rejects unconfirmed orders as "table closed" and frees the table.

### The two clocks

| Clock | Column | Default | Range | Extended by activity? |
| --- | --- | --- | --- | --- |
| Idle window | `last_activity_at` vs `session_idle_minutes` | 90 min | 30–240 | Yes — slid by any request (throttled to once a minute) |
| Hard cap | `hard_expires_at` | 4 h | 1–8 | **No**, never |

Both are evaluated in SQL against `now()` — the database clock, never the browser's — on **every**
session lookup (`getSessionFromCookie`), so a session cannot outlive its cap by simply not asking.
The cron job closes the leftovers and prunes dead codes.

### Limits and races

| Guard | Where | Why |
| --- | --- | --- |
| `SCAN_RATE_LIMIT` 120/10 min per IP | `app/api/public/[action]` (`session`) | scanning writes rows; every phone in the room shares the restaurant Wi-Fi IP, so the window is loose |
| `OTP_VERIFY_RATE_LIMIT` 60/10 min per IP | `app/api/public/[action]` (`verify-otp`) | same reason; the real guess limiter is the per-code 5 attempts |
| 5 attempts per code, atomic | `consumeOtp()` | a distributed guess spreads over IPs but still dies on the 5th try |
| One live code per table | partial unique index `one_live_per_table` | two simultaneous scans cannot produce two cards |
| Re-issue cooldown 60 s | `raiseOtp()` | "Ask again" cannot page the waiter every second; the waiter's **New code** ignores it (explicit staff action) |
| Device cap 4–20 (default 12) | `issueDeviceToken()` | a flood cannot displace a real guest's token; the insert is plain, so the 13th phone gets a 409 |
| Wi-Fi password gating | `getWifiCard()` | never in the scan response or the state payload — only for a live device token |
| Compare-and-set order status | `updateOrderStatus()` | `update … where status = any($n)` + rowcount: two waiters cannot both confirm/reject |
| `unique(session_id, batch_no)` | migration 0005 | `max(batch_no)+1` is a read-then-write race; the losing insert retries |
| Codes never reach the kitchen | `app/api/staff/events` + role checks | the fingerprint and payload include codes for waiter/admin only; the kitchen role gets `codes: 0` |
| Cron secret | `app/api/cron/housekeeping` | shared secret only; production answers 503 when unset, and no user-agent is trusted |

## 2. Realtime with a polling fallback

```
Supabase configured?  ── yes ──►  supabaseBrowser()
                                    ├─ broadcast channel  restaurant-{id}   (server events)
                                    └─ postgres_changes   orders, waiter_calls (RLS-scoped)
                       ── no  ──►  poll /api/staff/events every 5 s
                                    (returns a fingerprint: counts + latest updated_at)
```

Both paths call the same `emit()` in `useStaffFeed`, which plays the configured sound, vibrates and
triggers a data reload. That means:

* the local demo behaves exactly like production (sound + refresh on change),
* if realtime sockets are blocked by a café firewall, staff still get alerts,
* the fingerprint endpoint is cheap (`count(*)` + `max(updated_at)`), so polling costs almost
  nothing on the free tiers.

Server events are broadcast from `/api/public/order`, `/api/public/call`, `/api/waiter/order` and
`/api/kitchen/order` via `broadcast()` in `src/server/repos/events.ts`, together with a Web Push
notification for backgrounded devices.

## 3. Game scoring

**Solo** is your own pace: 25 s to answer, an immediate verdict, a *Next question* button.

**Table ("play with friend") and whole-restaurant games run on the server's clock.**

| | Table | Whole restaurant |
| --- | --- | --- |
| Lobby | 25 s from the first tap (the rules are on screen) | the admin presses Start: 60 s to join, then 25 s of rules (joining closed), then it starts by itself |
| Each question | 15 s, same question on every phone | same |
| Joining after the start | refused (join the next round) | refused (the admin starts another game later) |
| Quitting | out for good, cannot return to that round | same |
| Score | each player's own | per table, see below |

Question *i* is on screen during `[starts_at + i·15 s, starts_at + (i+1)·15 s)`. The phone only keeps
an offset between its clock and the server's (`round.serverNow`, refreshed every 3 s); it never
decides which question is current, and `submitAnswer()` measures the time taken itself, from the moment
that question appeared (the phone's `msTaken` is not asked for). An answer is accepted only while its own
question is on screen. The speed bonus (up to 50) shrinks over the whole 15 s window.

While a sync game runs the API hides everything that could be a hint: the reply to an answer is only
`{ sync: true, answered: true }`; `getRoundState()` returns the questions up to the one on screen, zeroes
every score, and nulls right/wrong, points and the correct option; `getRoundResults()` answers 409 until the
round has ended. At the end, all of it is revealed.

**The restaurant game is started by the admin** (Admin → Games → *Start restaurant game*); nothing is scheduled.
`startRestaurantGame()` creates a `lobby` round that starts 85 s later. Phones learn about it through the state poll they
already make (`restaurantGame` in `/api/public/state`, one cheap query when no game is on) and show a banner on the home
and menu screens. At most 2 phones per table (`RESTAURANT_MAX_PLAYERS_PER_TABLE`; the seat is taken under a row lock).
When joining closes, and again at the start, a game with fewer than 2 tables is cancelled by itself
(`game_rounds.cancel_reason = 'not_enough_tables'`); the admin screen then says "not enough teams". One game at a time
per restaurant. After the match the admin sees the winner table, its players and the prize for that rank, with a
*Prize given* tick (`game_scores.prize_given_at`).

**Team score (whole restaurant).** Per question, a table scores only if **every** one of its players
answered correctly; it then gets the **average** of their points (100 + speed bonus). One wrong or missing
answer = 0 for the table on that question. A player who quit is left out from the question they quit on.
`finalizeRestaurantRound()` works this out once, when the clock ends the round (row-locked, idempotent), and
writes one `game_scores` row per table; the daily leaderboard adds those up as before.

Rounds are created in `lobby` and the clock decides when they become `active`. That transition is
**persisted** by `settleRoundStatus()`, which every read *and* `submitAnswer()` call first: a status that only
exists in one code path's memory produced "the screen says active, every answer says 409". Rounds are judged
against the database clock (`dbNowMs()`), so a phone with a skewed clock cannot jump the lobby.

The tests move time with `POST /api/dev/clock { op: 'round-at', roundId, elapsedSeconds }` (embedded demo
database only), which puts a round at a chosen moment of its timeline.

`settings.key = 'games'` holds:

| Key | Default | Meaning |
| --- | --- | --- |
| `roundsPerRound` | 10 | questions per round |
| `restaurantRoundIntervalMinutes` | 5 | public round cadence |
| `pointsCorrect` | 100 | base points per correct answer |
| `speedBonusMax` | 50 | extra points for an instant correct answer |
| `speedBonusWindowMs` | 10000 | bonus decays to zero over this window |
| `pointsMode` | `sum` | table score = sum of players, or `average` |

**Answer flow** (`POST /api/public/games/answer`):

1. Rate limit per (session, guest): 40 answers / 5 min.
2. Round must be `active` and inside its time window.
3. The player row must belong to this session + guest number.
4. `question_index` must not already be answered (`unique(player_id, question_index)`).
5. The **server** clamps `ms_taken` to the wall clock:
   `maxAllowed = elapsedSinceStart + 2s − player.totalMs`, so a forged fast answer cannot earn an
   unearned bonus.
6. Score: `isCorrect ? pointsCorrect + round(speedBonusMax × (1 − ms/window)) : 0`.
7. Answer + player totals update in one transaction; finishing the round writes the table's
   `game_scores` row for the daily leaderboard.

**What the browser receives:** questions and options only. `correctIndex` and `explanation` are
returned **only** for questions that player has already answered (or for everyone once the round
is finished). No endpoint returns the key for an unanswered question.

**Tie-breaks:** higher score wins, then lower total time (`total_ms`), then earlier join.

**Daily leaderboard:** `game_scores` rows carry `play_date` in restaurant-local time
(`Asia/Kolkata`). The public board aggregates only `mode = 'restaurant'` rows for today, ranked by
`sum(points)` or `avg(points)` depending on `pointsMode`, and attaches the prize for each rank.

## 4. Money handling

* `menu_items_public` is a database view that computes `effective_price` and `offer_active` with
  the offer window evaluated **in SQL at query time** — the browser never decides the price.
* `sendOrder()` re-reads those rows inside the transaction, checks `is_available`, sums
  `effective_price × qty`, applies `tax_percent` and `service_charge_percent` from `restaurants`,
  and stores a **snapshot** of each item's name and unit price on `order_items`. Historical orders
  therefore stay correct after a price change.
* The client may send whatever it likes in the request body; Zod strips unknown keys and the
  repository ignores anything money-related that did not come from the database.

## 5. Why two database drivers

| | `pg` (production) | PGlite (local/demo) |
| --- | --- | --- |
| Where | Supabase pooler / any Postgres | WASM Postgres inside the Node process |
| Setup | `DATABASE_URL` | none |
| Migrations | run once by you / `supabase db push` | applied automatically on first boot from `supabase/migrations` + `supabase/seed` |
| RLS | enforced for anon/authenticated; the app connects with the service role and enforces scope in the repository layer | roles exist so the same policies compile; the app is the only client |

`src/server/db.ts` exposes `query`, `one` and `transaction` for both, so every repository function
is written once. Bump `DB_MIGRATIONS_VERSION` in that file after changing migrations during a dev
session to force a fresh in-memory database (production is unaffected).

## 6. Failure behaviour

| Failure | What the user sees |
| --- | --- |
| No code yet / session expired / closed by a waiter | The code screen again ("Enter a new code from your waiter to keep ordering. Your bill is not affected."), with the read-only menu still reachable |
| Wrong table code | Attempts left ("That code is not right. 4 left."), the field clears, the counter is on the waiter's card too |
| Code locked after 5 tries | "Too many wrong attempts. Ask your waiter for a new code." + **Ask again** (subject to the cooldown) |
| No staff device polling for 60 s | "No staff device is online. Please call a staff member." + the restaurant's phone number as a tap-to-call |
| Cookies blocked / in-app browser | An amber notice on the code screen naming the fix (open in Safari/Chrome, allow cookies) instead of a silent loop |
| 13th phone on the table | Clear 409 message from `/verify-otp` — nobody else's phone is displaced |
| Network drop mid-session | Persistent offline banner; polling resumes when back |
| Sold-out item left in the cart | Order rejected with the item names, cart kept so it can be fixed |
| Waiter rejects an order | Guest sees the reason on the status card and can re-order |
| Push permission denied | Staff still get in-app sound/vibration; the banner explains it |
| Supabase realtime unavailable | Automatic polling fallback (no extra configuration) |
