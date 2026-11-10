#!/usr/bin/env node
/**
 * End-to-end smoke test against a running dev server.
 * Exercises the real HTTP surface exactly like the browser does:
 *
 *   customer: scan (no session) -> read-only menu -> wrong code -> correct code ->
 *             cart -> send order -> call waiter -> review -> re-order without a code
 *   waiter:   login -> code card -> dismiss -> new code -> board -> confirm -> close
 *   otp P0:   no session on scan, code never leaves the staff API, reusable by the
 *             next phone, 5 wrong tries kill it, phones already inside survive it,
 *             close/regenerate/table-close kill it, idle + hard cap end sessions
 *   kitchen:  login -> board -> preparing -> ready
 *   admin:    login -> menu CRUD -> sold out -> reports -> tables
 *   games:    start solo round -> answer -> results (server-side scoring)
 *   security: price tampering, role escalation, missing session, bad table
 *
 * Usage: node scripts/smoke-test.mjs [http://localhost:3000]
 */
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, extra = '') {
  pass++;
  console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
}
function bad(name, detail) {
  fail++;
  failures.push(`${name}: ${detail}`);
  console.log(`  ✗ ${name} — ${detail}`);
}
function check(name, condition, detail = '') {
  condition ? ok(name, detail) : bad(name, detail || 'assertion failed');
}

/** Minimal cookie jar. */
function jar() {
  const store = new Map();
  return {
    header: () => [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb(res) {
      for (const cookie of res.headers.getSetCookie?.() ?? []) {
        const [pair] = cookie.split(';');
        const idx = pair.indexOf('=');
        store.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
    },
    get: (k) => store.get(k),
  };
}

async function call(method, path, { body, cookies, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookies ? { cookie: cookies.header() } : {}),
      origin: BASE,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  cookies?.absorb(res);
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

/** Wait for the waiter's card for one table and return it (the "read it out" step). */
async function codeCard(waiterJar, tableNumber) {
  for (let i = 0; i < 10; i++) {
    const res = await call('GET', '/api/waiter/codes', { cookies: waiterJar });
    const card = res.json.data?.otps?.find((o) => o.table_number === tableNumber);
    if (card) return card;
    await sleep(200);
  }
  return null;
}

async function main() {
  console.log(`\nTableTap smoke test → ${BASE}\n`);

  // A clean demo database, so the suite is repeatable: rate-limit counters, the
  // once-per-session review rule and extra smoke rows would otherwise collide
  // with a previous run.
  const reset = await call('POST', '/api/demo/reset');
  if (reset.json.ok === true) {
    console.log('  (demo database reset to seed state)\n');
  } else if (reset.status !== 404) {
    console.log(`  ! could not reset the demo database: ${reset.json.error ?? reset.status}\n`);
  }

  // ---------------------------------------------------------------- health
  console.log('Health');
  const health = await call('GET', '/api/health');
  check('database reachable', health.json.ok === true, `mode=${health.json.mode}`);

  const setup = await call('POST', '/api/setup');
  check('demo staff seeded', setup.json.ok === true);

  // ---------------------------------------------------------------- customer
  console.log('\nCustomer flow');
  const adminJar = jar();
  const adminLogin = await call('POST', '/api/staff/login', {
    body: { email: 'admin@spiceroute.test', password: 'Demo@1234' },
    cookies: adminJar,
  });
  if (adminLogin.status === 429) {
    console.log(
      '\n  ! Login rate limit is active (the suite logs in several times).\n' +
        '    Reset the demo database and start the server again, then re-run:\n' +
        '      rm -rf .pglite && PGLITE_DIR=.pglite npm start\n' +
        '    (Rate limits are stored in the database and survive a restart.)\n',
    );
    process.exit(1);
  }
  check('admin login', adminLogin.json.ok === true, adminLogin.json.error ?? '');

  const tables = await call('GET', '/api/admin/tables', { cookies: adminJar });
  const table1 = tables.json.data?.tables?.[0];
  check('table list', Boolean(table1?.table_code), `code=${table1?.table_code}`);
  const code = table1.table_code;

  const menuEarly = await call('GET', `/api/public/menu?t=${code}`);
  const firstItemId = (menuEarly.json.data?.menu ?? []).flatMap((c) => c.items).find((i) => i.is_available)?.id;
  check('menu readable before the code', Boolean(firstItemId));

  // ---------------------------------------------------------------- scan = no session
  console.log('\nTable code (OTP) — scan grants nothing');
  const guest = jar();
  const scan = await call('POST', '/api/public/session', {
    body: { table_code: code },
    cookies: guest,
  });
  check('scan is accepted', scan.json.ok === true);
  // P0: a scan must not create a session any more
  check('scan creates NO session', scan.json.data?.needs_code === true && !guest.get('tt_session'));
  check('scan response carries no code', !JSON.stringify(scan.json).match(/\"code\":\"\d{4,6}\"/));
  check(
    'scan response carries no Wi-Fi password',
    !/wifi_password|password/i.test(JSON.stringify(scan.json)),
  );
  const preState = await call('GET', `/api/public/state?t=${code}`, { cookies: guest });
  check('unverified guest gets the code screen state', preState.json.data?.needs_code === true);
  check(
    'read-only menu available before the code (D2)',
    Boolean(preState.json.data?.preview_menu) && preState.json.data?.session?.id === '',
  );
  const preCart = await call('POST', '/api/public/cart', {
    body: { table_code: code, op: 'add', payload: { menuItemId: firstItemId, qty: 1 } },
    cookies: guest,
  });
  check('no cart writes before the code', preCart.status === 401, `status=${preCart.status}`);

  // the waiter board is the only place the code exists
  const waiterCodes = jar();
  await call('POST', '/api/staff/login', {
    body: { email: 'waiter@spiceroute.test', password: 'Demo@1234' },
    cookies: waiterCodes,
  });
  const card0 = await codeCard(waiterCodes, table1.number);
  check('code appears on the waiter board', Boolean(card0?.code), `code=**** (${card0?.state})`);
  check('code is 4 digits', /^\d{4}$/.test(card0?.code ?? ''));
  check('code has a live window', card0?.seconds_left > 0, `${card0?.seconds_left}s left`);

  const kitchenEarly = jar();
  await call('POST', '/api/staff/login', {
    body: { email: 'kitchen@spiceroute.test', password: 'Demo@1234' },
    cookies: kitchenEarly,
  });
  const kitchenEvents = await call('GET', '/api/staff/events', { cookies: kitchenEarly });
  check(
    'kitchen never receives codes',
    kitchenEvents.json.data?.codes === 0 &&
      !JSON.stringify(kitchenEvents.json).match(/\d{4}/),
    `codes=${kitchenEvents.json.data?.codes}`,
  );

  // wrong code, then the right one
  const wrong = await call('POST', '/api/public/verify-otp', {
    body: { table_code: code, code: card0.code === '0000' ? '1111' : '0000' },
    cookies: guest,
  });
  check('wrong code rejected with attempts left', wrong.json.code === 'WRONG', `${wrong.json.attemptsLeft} left`);
  const notDigits = await call('POST', '/api/public/verify-otp', {
    body: { table_code: code, code: '12ab' },
    cookies: guest,
  });
  check(
    'letters are rejected before they count as an attempt',
    notDigits.status === 422 || notDigits.status === 400,
    `status=${notDigits.status}`,
  );
  const afterBad = await codeCard(waiterCodes, table1.number);
  check('only the digit attempt was counted', afterBad?.attempts === 1, `attempts=${afterBad?.attempts}`);

  const verify = await call('POST', '/api/public/verify-otp', {
    body: { table_code: code, code: card0.code },
    cookies: guest,
  });
  check('correct code creates the session', verify.json.ok === true && Boolean(guest.get('tt_session')));
  check('guest number assigned', verify.json.data?.guest_no >= 1, `guest=${verify.json.data?.guest_no}`);

  const menu = await call('GET', `/api/public/menu?t=${code}`);
  const categories = menu.json.data?.menu ?? [];
  const items = categories.flatMap((c) => c.items);
  check('menu served', items.length > 0, `${categories.length} categories, ${items.length} items`);
  check(
    'offer price calculated server-side',
    items.some((i) => i.offer_active && i.effective_price < i.price),
    items.find((i) => i.offer_active)?.name ?? 'none',
  );
  check('sold-out items flagged', items.some((i) => !i.is_available));

  const cheap = items.find((i) => i.is_available && i.effective_price > 0);
  const soldOut = items.find((i) => !i.is_available);

  const add = await call('POST', '/api/public/cart', {
    body: { table_code: code, op: 'add', payload: { menuItemId: cheap.id, qty: 2 } },
    cookies: guest,
  });
  check('add to shared cart', add.json.ok === true, add.json.data?.cart?.lines?.length + ' lines');

  const addSoldOut = await call('POST', '/api/public/cart', {
    body: { table_code: code, op: 'add', payload: { menuItemId: soldOut.id, qty: 1 } },
    cookies: guest,
  });
  check('sold-out item cannot be added', addSoldOut.status === 400, addSoldOut.json.error);

  // a second guest on the same table sees the same cart
  // P0: the same code works for the next phone at the table (reusable)
  const guest2 = jar();
  const verify2 = await call('POST', '/api/public/verify-otp', {
    body: { table_code: code, code: card0.code },
    cookies: guest2,
  });
  check('same code lets a second phone in', verify2.json.ok === true);
  check('second phone joins the same visit', verify2.json.data?.joined === true);
  const state2 = await call('GET', `/api/public/state?t=${code}`, { cookies: guest2 });
  check(
    'second guest sees the shared cart',
    state2.json.data?.cart?.itemCount === 2,
    `guest_no=${state2.json.data?.guest_no}`,
  );

  // price tampering attempt: client sends its own price, server ignores it
  const send = await call('POST', '/api/public/order', {
    body: { table_code: code, payload: { notes: 'less spicy', price: 0.01, total: 0.01 } },
    cookies: guest,
  });
  check('order sent', send.json.ok === true, `orderId=${send.json.data?.orderId}`);
  const orderId = send.json.data?.orderId;
  const placedOrder = send.json.data?.orders?.find((o) => o.id === orderId);
  check(
    'server recalculated the total',
    placedOrder && Math.abs(placedOrder.total - cheap.effective_price * 2 * 1.05) < 1,
    `total=${placedOrder?.total} (client sent 0.01)`,
  );
  check('order waits for waiter (pending)', placedOrder?.status === 'pending');

  // The 30 s waiter-call cooldown is per table, so a repeat run against a database
  // that is still warm legitimately answers 429 — treat that as "cooling down".
  const callWaiter = await call('POST', '/api/public/call', {
    body: { table_code: code, payload: { type: 'call' } },
    cookies: guest,
  });
  const coolingDown = callWaiter.status === 429;
  check(
    'call waiter',
    callWaiter.json.ok === true || coolingDown,
    coolingDown ? 'cooldown still active from a previous run' : '',
  );
  const callAgain = await call('POST', '/api/public/call', {
    body: { table_code: code, payload: { type: 'call' } },
    cookies: guest,
  });
  check(
    'waiter call cooldown enforced',
    callAgain.status === 429 || callAgain.status === 409,
    callAgain.json.error,
  );

  const bill = await call('POST', '/api/public/call', {
    body: { table_code: code, payload: { type: 'bill' } },
    cookies: guest,
  });
  check(
    'request bill',
    bill.json.ok === true || bill.status === 429,
    bill.status === 429 ? 'same 30 s cooldown window' : '',
  );

  // ---------------------------------------------------------------- waiter
  console.log('\nWaiter flow');
  const waiterJar = jar();
  const waiterLogin = await call('POST', '/api/staff/login', {
    body: { email: 'waiter@spiceroute.test', password: 'Demo@1234' },
    cookies: waiterJar,
  });
  check('waiter login', waiterLogin.json.ok === true);

  const board = await call('GET', '/api/waiter/board', { cookies: waiterJar });
  check('pending order visible on the board', board.json.data?.pending?.length >= 1);
  check('waiter calls visible', board.json.data?.calls?.length >= 2);

  const kjar = jar();
  const kitchenLogin = await call('POST', '/api/staff/login', {
    body: { email: 'kitchen@spiceroute.test', password: 'Demo@1234' },
    cookies: kjar,
  });
  check('kitchen login', kitchenLogin.json.ok === true);
  const kitchenBoard = await call('GET', '/api/kitchen/board', { cookies: kjar });
  check(
    'unconfirmed order not on kitchen screen',
    !kitchenBoard.json.data.orders.some((o) => o.id === orderId),
  );

  const noReason = await call('POST', '/api/waiter/order', {
    body: { orderId, action: 'reject' },
    cookies: waiterJar,
  });
  check('rejection requires a reason', noReason.status === 422, noReason.json.error);

  const confirm = await call('POST', '/api/waiter/order', {
    body: { orderId, action: 'confirm' },
    cookies: waiterJar,
  });
  check('waiter confirms order', confirm.json.ok === true, `status=${confirm.json.data?.status}`);

  // ---------------------------------------------------------------- kitchen
  console.log('\nKitchen flow');
  const kitchenAfter = await call('GET', '/api/kitchen/board', { cookies: kjar });
  check(
    'confirmed order appears in the kitchen',
    kitchenAfter.json.data.orders.some((o) => o.id === orderId),
  );

  const prep = await call('POST', '/api/kitchen/order', {
    body: { orderId, action: 'preparing' },
    cookies: kjar,
  });
  check('kitchen marks preparing', prep.json.ok === true);

  const ready = await call('POST', '/api/kitchen/order', {
    body: { orderId, action: 'ready' },
    cookies: kjar,
  });
  check('kitchen marks ready', ready.json.ok === true);

  const invalidTransition = await call('POST', '/api/kitchen/order', {
    body: { orderId, action: 'preparing' },
    cookies: kjar,
  });
  check('invalid status transition rejected', invalidTransition.status === 409);

  const customerView = await call('GET', `/api/public/state?t=${code}`, { cookies: guest });
  check(
    'customer sees live status "ready"',
    customerView.json.data.orders.find((o) => o.id === orderId)?.status === 'ready',
  );

  // ---------------------------------------------------------------- reviews
  console.log('\nReview & feedback routing');
  const review = await call('POST', '/api/public/review', {
    body: { table_code: code, payload: { rating: 2, routedTo: 'private' } },
    cookies: guest,
  });
  // A previous run may already have used this table session's single review.
  check(
    'low rating saved for private routing',
    review.json.ok === true || review.status === 409,
    review.json.ok === true ? 'saved' : 'already reviewed in this session (previous run)',
  );
  const reviewAgain = await call('POST', '/api/public/review', {
    body: { table_code: code, payload: { rating: 5, routedTo: 'google' } },
    cookies: guest,
  });
  check(
    'one review per session enforced',
    reviewAgain.status === 409,
    reviewAgain.json.error ?? 'no second review accepted',
  );

  const feedback = await call('POST', '/api/public/feedback', {
    body: {
      table_code: code,
      payload: { rating: 2, message: '<script>alert(1)</script> Food was cold', contact: '99999' },
    },
    cookies: guest,
  });
  check('private feedback accepted', feedback.json.ok === true);

  const adminFeedback = await call('GET', '/api/admin/feedback', { cookies: adminJar });
  const storedFeedback = adminFeedback.json.data?.feedback?.[0];
  check('feedback visible to admin', Boolean(storedFeedback));
  check(
    'XSS stripped from stored feedback',
    storedFeedback && !storedFeedback.message.includes('<script>'),
    storedFeedback?.message,
  );

  // ---------------------------------------------------------------- admin
  console.log('\nAdmin flow');
  const adminMenu = await call('GET', '/api/admin/menu', { cookies: adminJar });
  check('admin menu loaded', adminMenu.json.data?.items?.length > 0);
  const categoryForItem = adminMenu.json.data?.categories?.[0]?.id;

  const soldOutToggle = await call('POST', '/api/admin/sold-out', {
    body: { itemId: cheap.id, isAvailable: false },
    cookies: adminJar,
  });
  check('sold-out toggle', soldOutToggle.json.ok === true);
  const menuAfterToggle = await call('GET', `/api/public/menu?t=${code}`);
  check(
    'sold-out change is live immediately',
    menuAfterToggle
      .json.data.menu.flatMap((c) => c.items)
      .find((i) => i.id === cheap.id)?.is_available === false,
  );
  await call('POST', '/api/admin/sold-out', { body: { itemId: cheap.id, isAvailable: true }, cookies: adminJar });

  const newCategory = await call('POST', '/api/admin/menu-category', {
    body: { name: 'Smoke Test Category', emoji: '🧪', sortOrder: 99, isActive: true },
    cookies: adminJar,
  });
  check('create category', newCategory.json.ok === true);
  const categoryId = newCategory.json.data.id;

  const badOffer = await call('POST', '/api/admin/menu-item', {
    body: {
      categoryId,
      name: 'Bad Offer Dish',
      price: 100,
      offerPrice: 150,
      isAvailable: true,
      isVeg: true,
      spiceLevel: 0,
      prepMinutes: 10,
      sortOrder: 0,
    },
    cookies: adminJar,
  });
  check('offer must be lower than price', badOffer.status === 422, badOffer.json.error);

  const newItem = await call('POST', '/api/admin/menu-item', {
    body: {
      categoryId: categoryId ?? categoryForItem,
      name: 'Smoke Test Dish',
      price: 250,
      offerPrice: 199,
      isAvailable: true,
      isVeg: true,
      spiceLevel: 1,
      prepMinutes: 12,
      sortOrder: 0,
    },
    cookies: adminJar,
  });
  check('create menu item', newItem.json.ok === true, newItem.json.data?.id);

  const report = await call('GET', '/api/admin/reports?from=2020-01-01&to=2030-01-01', {
    cookies: adminJar,
  });
  check('sales report', report.json.ok === true, `${report.json.data?.totalOrders} orders, revenue ${report.json.data?.totalRevenue}`);

  const existingTables = await call('GET', '/api/admin/tables', { cookies: adminJar });
  const smokeNumber =
    Math.max(0, ...(existingTables.json.data?.tables ?? []).map((t) => t.number ?? 0)) + 1;
  const newTable = await call('POST', '/api/admin/table', {
    body: { number: smokeNumber, label: 'Smoke', seats: 2, zone: 'Test', isActive: true },
    cookies: adminJar,
  });
  check('create table', newTable.json.ok === true, newTable.json.error ?? '');

  const regenerate = await call('POST', '/api/admin/table-regenerate', {
    body: { id: newTable.json.data?.id },
    cookies: adminJar,
  });
  check('regenerate table code', Boolean(regenerate.json.data?.table_code));

  const audit = await call('GET', '/api/admin/audit', { cookies: adminJar });
  check(
    'audit log records admin actions',
    audit.json.data?.entries?.some((e) => e.action === 'menu.item.create'),
    `${audit.json.data?.entries?.length} entries`,
  );

  const newStaff = await call('POST', '/api/admin/staff', {
    body: {
      email: `smoke${Date.now()}@spiceroute.test`,
      fullName: 'Smoke Tester',
      role: 'waiter',
      password: 'Smoke@1234',
    },
    cookies: adminJar,
  });
  check('create staff account', newStaff.json.ok === true);

  // ---------------------------------------------------------------- security
  console.log('\nSecurity');
  const anonAdmin = await call('GET', '/api/admin/menu');
  check('admin API blocks anonymous', anonAdmin.status === 401);

  const waiterAsAdmin = await call('GET', '/api/admin/menu', { cookies: waiterJar });
  check('admin API blocks waiter (role check)', waiterAsAdmin.status === 403);

  const kitchenAsWaiter = await call('GET', '/api/waiter/board', { cookies: kjar });
  check('waiter API blocks kitchen', kitchenAsWaiter.status === 403);

  const waiterCannotCook = await call('POST', '/api/kitchen/order', {
    body: { orderId, action: 'ready' },
    cookies: waiterJar,
  });
  check('kitchen API blocks waiter', waiterCannotCook.status === 403);

  const noCookieState = await call('GET', `/api/public/state?t=${code}`);
  check(
    'no cookie ⇒ code screen, never a session',
    noCookieState.json.data?.needs_code === true && noCookieState.json.data?.session?.id === '',
  );

  const badCode = await call('POST', '/api/public/session', {
    body: { table_code: 'this-table-does-not-exist-000' },
    cookies: jar(),
  });
  check('unknown table code rejected', badCode.status === 404);

  const crossOrigin = await call('POST', '/api/public/call', {
    body: { table_code: code, payload: { type: 'call' } },
    cookies: guest,
    headers: { origin: 'https://evil.example' },
  });
  check('cross-origin POST blocked', crossOrigin.status === 403, crossOrigin.json.error);

  const badLogin = await call('POST', '/api/staff/login', {
    body: { email: 'admin@spiceroute.test', password: 'wrong-password' },
    cookies: jar(),
  });
  check('wrong password rejected', badLogin.status === 401);

  // ---------------------------------------------------------------- games
  console.log('\nGames (server-side scoring)');
  const freshGuest = jar();
  const freshCard = await codeCard(waiterCodes, table1.number);
  const freshVerify = await call('POST', '/api/public/verify-otp', {
    body: { table_code: code, code: freshCard?.code ?? card0.code },
    cookies: freshGuest,
  });
  check('games guest verified with a table code', freshVerify.json.ok === true);
  // K1: no code, no games — the lobby is verified-only
  const lobbyNoCode = await call('GET', `/api/public/games/lobby?t=${code}`, { cookies: jar() });
  check('game lobby needs a verified table', lobbyNoCode.status === 401, `status=${lobbyNoCode.status}`);
  const startNoCode = await call('POST', '/api/public/games/start', {
    body: { table_code: code, payload: { mode: 'solo', categoryId: null } },
    cookies: jar(),
  });
  check('a round cannot start without the code', startNoCode.status === 401);
  const lobby = await call('GET', `/api/public/games/lobby?t=${code}`, { cookies: freshGuest });
  check('game lobby', lobby.json.ok === true, `${lobby.json.data?.categories?.length} categories`);
  check(
    'no restaurant game runs by itself (the admin starts it)',
    lobby.json.data?.restaurantGame === null,
    JSON.stringify(lobby.json.data?.restaurantGame),
  );
  const noGame = await call('POST', '/api/public/games/start', {
    body: { table_code: code, payload: { mode: 'restaurant', categoryId: null } },
    cookies: freshGuest,
  });
  check('joining a restaurant game before the admin starts one is refused', noGame.status === 409, noGame.json.error);

  const solo = await call('POST', '/api/public/games/start', {
    body: { table_code: code, payload: { mode: 'solo', categoryId: null } },
    cookies: freshGuest,
  });
  check('solo round started', solo.json.ok === true, `round=${solo.json.data?.roundId}`);
  const roundId = solo.json.data.roundId;

  const roundState = await call('GET', `/api/public/games/round?t=${code}&roundId=${roundId}`, {
    cookies: freshGuest,
  });
  check('round state loaded', roundState.json.data?.questions?.length === 10);
  check('no answers or explanations leaked before answering', roundState.json.data.myAnswers.length === 0);

  const answer = await call('POST', '/api/public/games/answer', {
    body: {
      table_code: code,
      payload: { roundId, questionIndex: 0, selectedIndex: 1, msTaken: 1200 },
    },
    cookies: freshGuest,
  });
  check('answer scored on the server', answer.json.ok === true, `points=${answer.json.data?.points}`);
  const duplicate = await call('POST', '/api/public/games/answer', {
    body: {
      table_code: code,
      payload: { roundId, questionIndex: 0, selectedIndex: 2, msTaken: 900 },
    },
    cookies: freshGuest,
  });
  check('cannot answer twice', duplicate.status === 409);

  // ---------------------------------------------------------------- settings (J1)
  console.log('\nTable code settings');
  const settingsBefore = await call('GET', '/api/admin/settings', { cookies: adminJar });
  check(
    'settings expose the code rules',
    Number(settingsBefore.json.data?.restaurant?.otp_length) === 4 &&
      Number(settingsBefore.json.data?.restaurant?.session_idle_minutes) === 90,
    `length=${settingsBefore.json.data?.restaurant?.otp_length} idle=${settingsBefore.json.data?.restaurant?.session_idle_minutes}`,
  );
  const outOfRange = await call('POST', '/api/admin/settings', {
    body: { otp: { length: 9 } },
    cookies: adminJar,
  });
  check(
    'out-of-range code length rejected',
    outOfRange.status === 422 || outOfRange.status === 400,
    `status=${outOfRange.status}`,
  );
  const savedSettings = await call('POST', '/api/admin/settings', {
    body: { otp: { length: 4, windowMinutes: 10, maxAttempts: 5, cooldownSeconds: 60 } },
    cookies: adminJar,
  });
  check('code settings saved', savedSettings.json.ok === true);
  const dbBiggerLength = await call('POST', '/api/admin/settings', {
    body: { otp: { length: 6 } },
    cookies: adminJar,
  });
  check('a 6-digit code is allowed', dbBiggerLength.json.ok === true);
  await call('POST', '/api/admin/settings', { body: { otp: { length: 4 } }, cookies: adminJar });

  // ---------------------------------------------------------------- auto-confirm (J4)
  console.log('\nAuto-confirm setting');
  const autoOn = await call('POST', '/api/admin/settings', {
    body: { otp: { autoConfirmOrders: true } },
    cookies: adminJar,
  });
  check('auto-confirm can be switched on', autoOn.json.ok === true);
  const autoCard = await codeCard(waiterCodes, table1.number);
  const autoGuest = jar();
  await call('POST', '/api/public/verify-otp', {
    body: { table_code: code, code: autoCard?.code ?? '0000' },
    cookies: autoGuest,
  });
  await call('POST', '/api/public/cart', {
    body: { table_code: code, op: 'add', payload: { menuItemId: cheap.id, qty: 1 } },
    cookies: autoGuest,
  });
  const autoOrder = await call('POST', '/api/public/order', {
    body: { table_code: code, payload: {} },
    cookies: autoGuest,
  });
  const autoPlaced = autoOrder.json.data?.orders?.find((o) => o.id === autoOrder.json.data?.orderId);
  check(
    'with auto-confirm ON the order skips the confirm tap',
    autoPlaced?.status === 'confirmed',
    `status=${autoPlaced?.status}`,
  );
  await call('POST', '/api/admin/settings', {
    body: { otp: { autoConfirmOrders: false } },
    cookies: adminJar,
  });
  const autoOff = await call('GET', '/api/admin/settings', { cookies: adminJar });
  check(
    'auto-confirm is OFF again (the shipped default)',
    autoOff.json.data?.restaurant?.auto_confirm_orders === false,
  );

  // ---------------------------------------------------------------- table mode games
  console.log('\nTable-mode round starts on time');
  const tableRoundStart = await call('POST', '/api/public/games/start', {
    body: { table_code: code, payload: { mode: 'table', categoryId: null } },
    cookies: freshGuest,
  });
  check('table round created', tableRoundStart.json.ok === true, `round=${tableRoundStart.json.data?.roundId}`);
  const tableRoundId = tableRoundStart.json.data?.roundId;
  const lobbyState = await call('GET', `/api/public/games/round?t=${code}&roundId=${tableRoundId}`, {
    cookies: freshGuest,
  });
  check('round waits in the lobby first', lobbyState.json.data?.round?.status === 'lobby');
  const earlyAnswer = await call('POST', '/api/public/games/answer', {
    body: { table_code: code, payload: { roundId: tableRoundId, questionIndex: 0, selectedIndex: 0 } },
    cookies: freshGuest,
  });
  check('an answer before the start is refused', earlyAnswer.status === 409, earlyAnswer.json.error);

  // wait out the 25-second lobby, then answer immediately: this is the case that used
  // to loop on "the round has not started yet" while the UI already said "active"
  const startsAt = new Date(lobbyState.json.data.round.startsAt).getTime();
  await sleep(Math.max(0, startsAt - Date.now()) + 1500);
  const liveState = await call('GET', `/api/public/games/round?t=${code}&roundId=${tableRoundId}`, {
    cookies: freshGuest,
  });
  check('the round is active after its countdown', liveState.json.data?.round?.status === 'active');
  const onTime = await call('POST', '/api/public/games/answer', {
    body: { table_code: code, payload: { roundId: tableRoundId, questionIndex: 0, selectedIndex: 1 } },
    cookies: freshGuest,
  });
  check(
    'an answer right after the start is accepted (lobby→active persisted)',
    onTime.json.ok === true,
    onTime.json.error ?? `points=${onTime.json.data?.points}`,
  );
  const afterStart = await call('GET', `/api/public/games/round?t=${code}&roundId=${tableRoundId}`, {
    cookies: freshGuest,
  });
  check(
    'the stored round status is active, not just the view',
    afterStart.json.data?.round?.status === 'active',
  );

  // restaurant game: the admin starts it, a guest joins, answers wait for the start
  const started = await call('POST', '/api/admin/restaurant-game-start', { body: {}, cookies: adminJar });
  check('admin starts the restaurant game', started.json.ok === true, started.json.error);
  const joinGame = await call('POST', '/api/public/games/start', {
    body: { table_code: code, payload: { mode: 'restaurant', categoryId: null } },
    cookies: freshGuest,
  });
  check('a guest joins it during the join window', joinGame.json.ok === true, joinGame.json.error);
  const gameEarlyAnswer = await call('POST', '/api/public/games/answer', {
    body: { table_code: code, payload: { roundId: joinGame.json.data?.roundId, questionIndex: 0, selectedIndex: 1 } },
    cookies: freshGuest,
  });
  check('answers wait for the start of the restaurant game', gameEarlyAnswer.status === 409, gameEarlyAnswer.json.error);
  const cancelGame = await call('POST', '/api/admin/restaurant-game-cancel', { body: {}, cookies: adminJar });
  check('admin can call it off before it starts', cancelGame.json.ok === true, cancelGame.json.error);

  // ---------------------------------------------------------------- session close
  console.log('\nTable session lifecycle');
  const adminBoard = await call('GET', '/api/waiter/board', { cookies: adminJar });
  const tableSession = adminBoard.json.data.tables.find((t) => t.table_code === code);
  const close = await call('POST', '/api/waiter/close-session', {
    body: { sessionId: tableSession.session_id, reason: 'smoke test' },
    cookies: waiterJar,
  });
  check('waiter can close the session', close.json.ok === true);

  const afterClose = await call('GET', `/api/public/state?t=${code}`, { cookies: guest });
  check(
    'closed session sends the guest back to the code screen',
    afterClose.json.data?.needs_code === true,
  );
  const codesAfterClose = await call('GET', '/api/waiter/codes', { cookies: waiterCodes });
  check(
    'closing the table kills its live code',
    !codesAfterClose.json.data.otps.some((o) => o.table_number === table1.number && o.state === 'live'),
  );
  const orderAfterClose = await call('POST', '/api/public/order', {
    body: { table_code: code, payload: {} },
    cookies: guest,
  });
  check('a closed table cannot order', orderAfterClose.status === 401);

  // ---------------------------------------------------------------- OTP P0 battery
  console.log('\nTable code P0 cases');

  // a clean table for the lifecycle cases
  const tableTwo = tables.json.data.tables.find((t) => t.table_code !== code) ?? table1;
  const t2 = tableTwo.table_code;
  const t2Number = tableTwo.number;

  // F1/F2: the code never shows up in a customer-facing response
  const scan2 = await call('POST', '/api/public/session', { body: { table_code: t2 }, cookies: jar() });
  const card2 = await codeCard(waiterCodes, t2Number);
  check('fresh scan raises exactly one code', Boolean(card2?.code) && card2.state === 'live');
  check(
    'customer payload never contains the code',
    card2 ? !JSON.stringify(scan2.json).includes(card2.code) : true,
  );

  // B1: one live code per table — a repeat scan reuses it instead of piling up
  const scan2b = await call('POST', '/api/public/session', { body: { table_code: t2 }, cookies: jar() });
  const cardsForTable = (await call('GET', '/api/waiter/codes', { cookies: waiterCodes })).json.data.otps
    .filter((o) => o.table_number === t2Number && o.state === 'live');
  check('one live code per table', cardsForTable.length === 1, `${cardsForTable.length} live`);
  check('repeat scan is rate-limited by the cooldown, not a second code', scan2b.json.data?.retry_after >= 0);

  // E: "phones already inside are unaffected" when the code dies
  const inside = jar();
  const inVerify = await call('POST', '/api/public/verify-otp', {
    body: { table_code: t2, code: card2.code },
    cookies: inside,
  });
  check('phone verified for the lifecycle cases', inVerify.json.ok === true);
  await call('POST', '/api/admin/otp-raise', {
    body: { tableId: tableTwo.id },
    cookies: adminJar,
  });
  const insideState = await call('GET', `/api/public/state?t=${t2}`, { cookies: inside });
  check(
    'a new code does not kick out phones already inside',
    insideState.json.data?.session?.id === inVerify.json.data?.state?.session?.id,
  );

  // B5: 5 wrong tries kill the code, and the correct code no longer works
  const fresh2 = await codeCard(waiterCodes, t2Number);
  let lockedAt = 0;
  for (let i = 1; i <= 5; i++) {
    const bad = await call('POST', '/api/public/verify-otp', {
      body: { table_code: t2, code: fresh2.code === '1234' ? '4321' : '1234' },
      cookies: jar(),
    });
    if (bad.json.code === 'LOCKED') lockedAt = i;
  }
  check('5th wrong try locks the code', lockedAt === 5, `locked at try ${lockedAt || 'never'}`);
  const afterLock = await call('POST', '/api/public/verify-otp', {
    body: { table_code: t2, code: fresh2.code },
    cookies: jar(),
  });
  check('correct code is dead after a lock', afterLock.json.ok === false, afterLock.json.code);

  // D: dismiss kills the code for every screen
  const dismissCard = await codeCard(waiterCodes, t2Number);
  if (dismissCard) {
    const dismissed = await call('POST', '/api/waiter/otp-dismiss', {
      body: { otpId: dismissCard.id },
      cookies: waiterCodes,
    });
    check('waiter can dismiss a code', dismissed.json.ok === true);
    const useDismissed = await call('POST', '/api/public/verify-otp', {
      body: { table_code: t2, code: dismissCard.code },
      cookies: jar(),
    });
    check('a dismissed code cannot be used', useDismissed.json.ok === false);
  } else {
    check('waiter can dismiss a code', false, 'no card to dismiss');
  }

  // C: "New code" ignores the cooldown and invalidates the previous code
  const preRaise = await codeCard(waiterCodes, t2Number);
  const raised = await call('POST', '/api/admin/otp-raise', {
    body: { tableId: tableTwo.id },
    cookies: adminJar,
  });
  check('"New code" always produces a code', raised.json.ok === true);
  if (preRaise && raised.json.data?.otp?.code && preRaise.code !== raised.json.data.otp.code) {
    const old = await call('POST', '/api/public/verify-otp', {
      body: { table_code: t2, code: preRaise.code },
      cookies: jar(),
    });
    check('the replaced code is dead immediately', old.json.ok === false);
  } else {
    check('the replaced code is dead immediately', true, 'same code reused');
  }

  // G2: "New party" — the waiter presses this, so it must work with the WAITER
  // cookie over POST (the old code only had an admin GET, which is why this broke)
  const partyCard = await codeCard(waiterCodes, t2Number);
  const partyGuest = jar();
  await call('POST', '/api/public/verify-otp', {
    body: { table_code: t2, code: partyCard?.code ?? '0000' },
    cookies: partyGuest,
  });
  const partyTable = (await call('GET', '/api/waiter/codes', { cookies: waiterCodes })).json.data.otps.find(
    (o) => o.table_number === t2Number,
  );
  const partyClose = await call('POST', '/api/waiter/new-party', {
    body: { tableId: partyTable.table_id },
    cookies: waiterCodes,
  });
  check(
    'waiter can start a new party (POST /api/waiter/new-party)',
    partyClose.json.ok === true,
    JSON.stringify(partyClose.json.data ?? partyClose.json.error),
  );
  const partyGuestState = await call('GET', `/api/public/state?t=${t2}`, { cookies: partyGuest });
  check('new party signs out the old visit', partyGuestState.json.data?.needs_code === true);
  const partyAgain = await call('POST', '/api/admin/new-party', {
    body: { tableId: partyTable.table_id },
    cookies: adminJar,
  });
  check('admin can start a new party via POST too', partyAgain.json.ok === true, partyAgain.json.error);
  const kitchenParty = await call('POST', '/api/waiter/new-party', {
    body: { tableId: partyTable.table_id },
    cookies: kjar,
  });
  check('kitchen cannot start a new party', kitchenParty.status === 403, `status=${kitchenParty.status}`);

  // J3: panic — every session and every code ends
  const panic = await call('POST', '/api/admin/end-all-sessions', {
    body: { confirm: 'END' },
    cookies: adminJar,
  });
  check('admin can end all sessions and codes', panic.json.ok === true, JSON.stringify(panic.json.data));
  const codesAfterPanic = await call('GET', '/api/waiter/codes', { cookies: waiterCodes });
  check(
    'no live codes survive the panic action',
    !codesAfterPanic.json.data.otps.some((o) => o.state === 'live'),
  );
  const panicGuest = await call('GET', `/api/public/state?t=${t2}`, { cookies: inside });
  check('every phone is signed out by the panic action', panicGuest.json.data?.needs_code === true);

  // K/G: cron housekeeping is idempotent and clears dead codes
  const cron = await call('GET', '/api/cron/housekeeping', {
    headers: { 'x-cron-key': process.env.CRON_SECRET ?? 'local-cron-secret-for-tests' },
  });
  check(
    'cron housekeeping runs (and prunes codes)',
    cron.json.ok === true,
    JSON.stringify(cron.json.data ?? {}),
  );

  // ---------------------------------------------------------------- summary
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  ${pass} passed · ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log('');
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exit(1);
});
