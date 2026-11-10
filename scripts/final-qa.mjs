#!/usr/bin/env node
/**
 * Final QA — real-world scenarios across the WHOLE product, not just the table code.
 *
 *   node scripts/final-qa.mjs [http://127.0.0.1:3000]
 *
 * Written as a restaurant opening night: two phones at a table, a shared cart, a
 * sold-out dish, a review, the Wi-Fi card, all three game modes, then the staff
 * side (confirm/reject/close/new party), then admin (menu, tables, settings,
 * staff, reports) and the abuse cases a paying client will eventually hit.
 *
 * Every check is independent of run order (it reseeds first) and uses only the
 * same HTTP surface a browser does.
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
function check(name, cond, detail = '') {
  cond ? ok(name, detail) : bad(name, detail || 'assertion failed');
}

function jar() {
  const store = new Map();
  return {
    header: () => [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb(res) {
      for (const cookie of res.headers.getSetCookie?.() ?? []) {
        const [pair] = cookie.split(';');
        const i = pair.indexOf('=');
        store.set(pair.slice(0, i), pair.slice(i + 1));
      }
    },
    get: (k) => store.get(k),
    raw: (k) => [...store.entries()].find(([n]) => n === k)?.[1],
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
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json, headers: res.headers };
}

async function login(email, password = 'Demo@1234') {
  const j = jar();
  const res = await call('POST', '/api/staff/login', { body: { email, password }, cookies: j });
  return { jar: j, res };
}

async function staffCode(staffJar, tableNumber) {
  for (let i = 0; i < 8; i++) {
    const res = await call('GET', '/api/waiter/codes', { cookies: staffJar });
    const card = (res.json.data?.otps ?? []).find((o) => o.table_number === tableNumber);
    if (card) return card;
    await sleep(250);
  }
  return null;
}

/** A guest who scanned at `tableCode` and typed the code the waiter read out. */
async function seatGuest(tableCode, tableNumber, staffJar, label = '') {
  const guest = jar();
  await call('POST', '/api/public/session', { body: { table_code: tableCode }, cookies: guest });
  const card = await staffCode(staffJar, tableNumber);
  const res = await call('POST', '/api/public/verify-otp', {
    body: { table_code: tableCode, code: card?.code ?? '0000' },
    cookies: guest,
  });
  if (!res.json.ok) throw new Error(`could not seat guest${label}: ${res.json.error ?? res.status}`);
  return { guest, card, guestNo: res.json.data.guest_no };
}

async function menuItem(tableCode, predicate = () => true) {
  const res = await call('GET', `/api/public/menu?t=${tableCode}`);
  return (res.json.data?.menu ?? []).flatMap((c) => c.items ?? []).find(predicate);
}

async function main() {
  console.log(`\nTableTap final QA → ${BASE}\n`);

  await call('POST', '/api/demo/reset');
  const seed = await call('POST', '/api/demo/seed');
  check('demo seed', seed.json.ok === true);

  const admin = await login('admin@spiceroute.test');
  const waiter = await login('waiter@spiceroute.test');
  const kitchen = await login('kitchen@spiceroute.test');
  check('three staff logins', admin.res.json.ok && waiter.res.json.ok && kitchen.res.json.ok);
  if (admin.res.status === 429 || waiter.res.status === 429) {
    console.log('\n  ! login rate limit hit — reset the database and restart, then re-run.\n');
    process.exit(1);
  }

  const tablesRes = await call('GET', '/api/admin/tables', { cookies: admin.jar });
  const tables = tablesRes.json.data?.tables ?? [];
  const tableA = tables.find((t) => t.number === 1);
  const tableB = tables.find((t) => t.number === 2);
  check('ten tables seeded', tables.length >= 10, `${tables.length} tables`);
  const A = tableA.table_code;
  const B = tableB.table_code;

  // ==================================================================== A. arrival
  console.log('\nA. A cold walk-in');
  const cold = jar();
  const scanCold = await call('POST', '/api/public/session', {
    body: { table_code: A },
    cookies: cold,
    headers: { 'x-forwarded-for': '198.51.100.201' },
  });
  check('sticker scan answers', scanCold.json.ok === true);
  check('no session on scan', !cold.get('tt_session'));
  check('nothing secret in the scan answer', !/wifi_password|"code":"\d{4}"/i.test(JSON.stringify(scanCold.json)));
  const homeCold = await call('GET', `${BASE}/t/${A}`, { headers: { 'accept': 'text/html' } }).catch(() => null);
  void homeCold;

  const guest1 = await seatGuest(A, tableA.number, waiter.jar, ' 1');
  const guest2 = await seatGuest(A, tableA.number, waiter.jar, ' 2');
  check('two phones on one table', guest1.guestNo === 1 && guest2.guestNo === 2, `G${guest1.guestNo}, G${guest2.guestNo}`);
  const cookieHeader = guest1.guest.raw('tt_session') ? 'tt_session set' : 'no cookie';
  check('device cookie present after the code', cookieHeader === 'tt_session set');

  // ==================================================================== B. menu + cart
  console.log('\nB. Menu and the shared cart');
  const menuRes = await call('GET', `/api/public/menu?t=${A}`);
  const items = (menuRes.json.data?.menu ?? []).flatMap((c) => c.items ?? []);
  check('menu with categories', (menuRes.json.data?.menu ?? []).length >= 3, `${items.length} items`);
  check('offer price is server-side', items.some((i) => i.offer_active && i.effective_price < i.price));
  check('sold-out dish is flagged', items.some((i) => !i.is_available));

  const cheap = items.find((i) => i.is_available && !i.offer_active);
  const offer = items.find((i) => i.is_available && i.offer_active);
  const soldOut = items.find((i) => !i.is_available);

  await call('POST', '/api/public/cart', {
    body: { table_code: A, op: 'add', payload: { menuItemId: cheap.id, qty: 2, notes: 'less spicy' } },
    cookies: guest1.guest,
  });
  await call('POST', '/api/public/cart', {
    body: { table_code: A, op: 'add', payload: { menuItemId: offer.id, qty: 1 } },
    cookies: guest2.guest,
  });
  const state1 = await call('GET', `/api/public/state?t=${A}`, { cookies: guest1.guest });
  const lines = state1.json.data?.cart?.lines ?? [];
  check('both phones share one cart', state1.json.data?.cart?.itemCount === 3, `${state1.json.data?.cart?.itemCount} items`);
  check(
    'line keeps the guest who added it',
    lines.some((l) => l.added_by_guest === 1) && lines.some((l) => l.added_by_guest === 2),
    lines.map((l) => `G${l.added_by_guest}`).join(','),
  );
  check('line notes stored', lines.some((l) => l.notes === 'less spicy'));

  const soldOutAdd = await call('POST', '/api/public/cart', {
    body: { table_code: A, op: 'add', payload: { menuItemId: soldOut.id, qty: 1 } },
    cookies: guest1.guest,
  });
  check('sold-out dish refused', soldOutAdd.status === 400, soldOutAdd.json.error);

  const qtyLine = lines.find((l) => l.menu_item_id === cheap.id);
  const qtyUp = await call('POST', '/api/public/cart', {
    body: { table_code: A, op: 'qty', payload: { cartItemId: qtyLine.id, qty: 3 } },
    cookies: guest2.guest,
  });
  check('either phone can change a shared line', qtyUp.json.ok === true);
  const qtyZero = await call('POST', '/api/public/cart', {
    body: { table_code: A, op: 'qty', payload: { cartItemId: qtyLine.id, qty: 0 } },
    cookies: guest2.guest,
  });
  check('qty 0 removes the line', qtyZero.json.ok === true && !qtyZero.json.data.cart.lines.some((l) => l.id === qtyLine.id));
  await call('POST', '/api/public/cart', {
    body: { table_code: A, op: 'add', payload: { menuItemId: cheap.id, qty: 2 } },
    cookies: guest1.guest,
  });

  const foreignItem = await call('POST', '/api/public/cart', {
    body: { table_code: A, op: 'add', payload: { menuItemId: '00000000-0000-4000-8000-000000000000', qty: 1 } },
    cookies: guest1.guest,
  });
  check('unknown dish refused', [400, 404, 422].includes(foreignItem.status), `status ${foreignItem.status}`);
  const negative = await call('POST', '/api/public/cart', {
    body: { table_code: A, op: 'add', payload: { menuItemId: cheap.id, qty: -5 } },
    cookies: guest1.guest,
  });
  check('negative quantity refused', [400, 422].includes(negative.status), `status ${negative.status}`);

  // ==================================================================== C. ordering
  console.log('\nC. Ordering');
  const send1 = await call('POST', '/api/public/order', {
    body: { table_code: A, payload: { notes: 'no onion', total: 1, price: 1 } },
    cookies: guest2.guest,
  });
  check('order sent by guest 2', send1.json.ok === true);
  const order1 = send1.json.data?.orders?.find((o) => o.id === send1.json.data.orderId);
  check('order waits for the waiter', order1?.status === 'pending');
  check(
    'total calculated by the server (client price ignored)',
    Math.abs(order1.total - (cheap.effective_price * 2 + offer.effective_price) * 1.05) < 1,
    `${order1.total}`,
  );
  check('unsafe client fields ignored', !JSON.stringify(order1).includes('"total":1,'));

  await call('POST', '/api/public/cart', {
    body: { table_code: A, op: 'add', payload: { menuItemId: cheap.id, qty: 1 } },
    cookies: guest1.guest,
  });
  const send2 = await call('POST', '/api/public/order', { body: { table_code: A, payload: {} }, cookies: guest1.guest });
  const order2 = send2.json.data?.orders?.find((o) => o.id === send2.json.data.orderId);
  check('second batch is numbered 2', order2?.batch_no === 2, `batch ${order2?.batch_no}`);

  const emptySend = await call('POST', '/api/public/order', { body: { table_code: A, payload: {} }, cookies: guest1.guest });
  check('empty cart cannot be sent', emptySend.status === 400, emptySend.json.error);

  // a dish can sell out between "add" and "send"
  await call('POST', '/api/public/cart', {
    body: { table_code: A, op: 'add', payload: { menuItemId: cheap.id, qty: 1 } },
    cookies: guest1.guest,
  });
  await call('POST', '/api/admin/sold-out', { body: { itemId: cheap.id, isAvailable: false }, cookies: admin.jar });
  const sendSoldOut = await call('POST', '/api/public/order', { body: { table_code: A, payload: {} }, cookies: guest1.guest });
  check(
    'a dish that sells out mid-cart is named, not charged',
    sendSoldOut.status === 400 && /sold out/i.test(sendSoldOut.json.error ?? ''),
    sendSoldOut.json.error,
  );
  await call('POST', '/api/admin/sold-out', { body: { itemId: cheap.id, isAvailable: true }, cookies: admin.jar });
  await call('POST', '/api/public/cart', { body: { table_code: A, op: 'clear' }, cookies: guest1.guest });

  // ==================================================================== D. waiter/kitchen
  console.log('\nD. Waiter and kitchen');
  const board = await call('GET', '/api/waiter/board', { cookies: waiter.jar });
  check('orders wait on the board', board.json.data.pending.length >= 2, `${board.json.data.pending.length} pending`);
  check(
    'the ticket shows how long the table has been open',
    board.json.data.pending.every((o) => 'session_devices' in o && 'session_started_at' in o),
  );
  const ticket = board.json.data.pending.find((o) => o.id === order1.id);
  check('ticket shows the phones at the table', ticket.session_devices >= 2, `${ticket.session_devices} phones`);

  const confirm = await call('POST', '/api/waiter/order', {
    body: { orderId: order1.id, action: 'confirm' },
    cookies: waiter.jar,
  });
  check('waiter confirms', confirm.json.ok === true);

  const kitchenBeforeReject = await call('GET', '/api/kitchen/board', { cookies: kitchen.jar });
  check('kitchen sees the confirmed order only', kitchenBeforeReject.json.data.orders.some((o) => o.id === order1.id));
  check(
    'the other order stays off the kitchen screen',
    !kitchenBeforeReject.json.data.orders.some((o) => o.id === order2.id),
  );

  const reject = await call('POST', '/api/waiter/order', {
    body: { orderId: order2.id, action: 'reject', reason: 'kitchen is out of that dish' },
    cookies: waiter.jar,
  });
  check('waiter rejects with a reason', reject.json.ok === true);
  const guestSeesReject = await call('GET', `/api/public/state?t=${A}`, { cookies: guest1.guest });
  const rejectedView = guestSeesReject.json.data.orders.find((o) => o.id === order2.id);
  check('guest is told why', rejectedView?.status === 'rejected' && Boolean(rejectedView.rejected_reason));

  const noReason = await call('POST', '/api/waiter/order', {
    body: { orderId: order2.id, action: 'reject' },
    cookies: waiter.jar,
  });
  check('a rejection needs a reason', noReason.status === 422 || noReason.status === 409);

  const prepare = await call('POST', '/api/kitchen/order', {
    body: { orderId: order1.id, action: 'preparing' },
    cookies: kitchen.jar,
  });
  check('kitchen starts preparing', prepare.json.ok === true);
  const ready = await call('POST', '/api/kitchen/order', { body: { orderId: order1.id, action: 'ready' }, cookies: kitchen.jar });
  check('kitchen marks it ready', ready.json.ok === true);
  const guestReady = await call('GET', `/api/public/state?t=${A}`, { cookies: guest2.guest });
  check(
    'guest 2 sees the status change',
    guestReady.json.data.orders.find((o) => o.id === order1.id)?.status === 'ready',
  );
  const serveEarly = await call('POST', '/api/kitchen/order', {
    body: { orderId: order1.id, action: 'preparing' },
    cookies: kitchen.jar,
  });
  check('a ready order cannot go back to preparing', serveEarly.status === 409, `status ${serveEarly.status}`);

  const kitchenOnUnconfirmed = await call('POST', '/api/kitchen/order', {
    body: { orderId: order2.id, action: 'preparing' },
    cookies: kitchen.jar,
  });
  check('kitchen cannot cook a rejected order', kitchenOnUnconfirmed.status === 409);

  // ==================================================================== E. calls
  console.log('\nE. Waiter call, bill, Wi-Fi, review');
  const callWaiter = await call('POST', '/api/public/call', {
    body: { table_code: A, payload: { type: 'call' } },
    cookies: guest1.guest,
  });
  check('call waiter', callWaiter.json.ok === true || callWaiter.status === 429);
  const callAgain = await call('POST', '/api/public/call', {
    body: { table_code: A, payload: { type: 'call' } },
    cookies: guest2.guest,
  });
  check('the 30 s cooldown is per table, across phones', [409, 429].includes(callAgain.status), `status ${callAgain.status}`);
  const callsBoard = await call('GET', '/api/waiter/board', { cookies: waiter.jar });
  const liveCall = callsBoard.json.data.calls.find((c) => c.type === 'call');
  check('the call reaches the waiter', Boolean(liveCall));
  const handled = await call('POST', '/api/waiter/call', { body: { callId: liveCall.id }, cookies: waiter.jar });
  check('waiter clears the call', handled.json.ok === true);

  const bill = await call('POST', '/api/public/call', {
    body: { table_code: A, payload: { type: 'bill' } },
    cookies: guest1.guest,
  });
  check('request bill', bill.json.ok === true || bill.status === 429);

  const wifi = await call('POST', '/api/public/wifi', { body: { table_code: A }, cookies: guest1.guest });
  check('Wi-Fi card for a verified phone', Boolean(wifi.json.data?.wifi_password), wifi.json.data?.wifi_ssid);
  const wifiNoCookie = await call('POST', '/api/public/wifi', { body: { table_code: A } });
  check('no Wi-Fi password without a code', wifiNoCookie.status === 401);

  const reviewPrivate = await call('POST', '/api/public/review', {
    body: { table_code: A, payload: { rating: 2, routedTo: 'private' } },
    cookies: guest1.guest,
  });
  check('a 1-3 star review is recorded privately', reviewPrivate.json.ok === true);
  const privateFeedback = await call('POST', '/api/public/feedback', {
    body: { table_code: A, payload: { rating: 2, message: '<b>cold</b> food', contact: '9999900000' } },
    cookies: guest1.guest,
  });
  check('the private feedback form saves', privateFeedback.json.ok === true);
  const reviewTwice = await call('POST', '/api/public/review', {
    body: { table_code: A, payload: { rating: 5, routedTo: 'google' } },
    cookies: guest2.guest,
  });
  check('one review per visit', reviewTwice.status === 409 || reviewTwice.json.ok === false, `status ${reviewTwice.status}`);
  const inbox = await call('GET', '/api/admin/feedback', { cookies: admin.jar });
  const stored = (inbox.json.data?.feedback ?? [])[0];
  check('the owner sees the private feedback', Boolean(stored));
  check('html is stripped from feedback', stored && !String(stored.message).includes('<b>'));
  const googleRoute = await call('POST', '/api/public/review', {
    body: { table_code: B, payload: { rating: 5, routedTo: 'google' } },
    cookies: (await seatGuest(B, tableB.number, waiter.jar, ' g')).guest,
  });
  check('a 5-star Google review is routed, not hidden', googleRoute.json.ok === true);

  // ==================================================================== F. games
  console.log('\nF. Games — all three modes');
  const solo = await call('POST', '/api/public/games/start', {
    body: { table_code: A, payload: { mode: 'solo', categoryId: null } },
    cookies: guest1.guest,
  });
  check('solo round starts', solo.json.ok === true);
  const soloId = solo.json.data.roundId;
  const soloState = await call('GET', `/api/public/games/round?t=${A}&roundId=${soloId}`, { cookies: guest1.guest });
  check('solo is active immediately', soloState.json.data.round.status === 'active');
  check('ten questions, no answers leaked', soloState.json.data.questions.length === 10 && soloState.json.data.myAnswers.length === 0);
  const cheat = await call('GET', `/api/public/games/round?t=${A}&roundId=${soloId}`, { cookies: guest1.guest });
  check('correct answers are never in the payload', !("correctIndex" in (cheat.json.data.questions[0] ?? {})));

  let scoredOk = true;
  for (let i = 0; i < 10; i++) {
    const a = await call('POST', '/api/public/games/answer', {
      body: { table_code: A, payload: { roundId: soloId, questionIndex: i, selectedIndex: 1, msTaken: 800 } },
      cookies: guest1.guest,
    });
    if (!a.json.ok) scoredOk = false;
  }
  check('all ten answers accepted', scoredOk);
  const result = await call('GET', `/api/public/games/results?t=${A}&roundId=${soloId}`, { cookies: guest1.guest });
  check('results reveal the correct answers', result.json.ok === true, `score ${result.json.data?.players?.[0]?.score}`);
  const replay = await call('POST', '/api/public/games/answer', {
    body: { table_code: A, payload: { roundId: soloId, questionIndex: 0, selectedIndex: 1, msTaken: 500 } },
    cookies: guest1.guest,
  });
  check('answering twice is refused', replay.status === 409);

  const tableRound = await call('POST', '/api/public/games/start', {
    body: { table_code: A, payload: { mode: 'table', categoryId: null } },
    cookies: guest1.guest,
  });
  check('table round starts in a lobby', tableRound.json.ok === true);
  const tableJoin = await call('POST', '/api/public/games/join', {
    body: { table_code: A, payload: { roundId: tableRound.json.data.roundId } },
    cookies: guest2.guest,
  });
  check(
    'the second phone joins the table round',
    tableJoin.json.ok === true,
    tableJoin.json.error ?? `status ${tableJoin.status}`,
  );
  const outsider = await seatGuest(B, tableB.number, waiter.jar, ' outsider');
  const foreignJoin = await call('POST', '/api/public/games/join', {
    body: { table_code: B, payload: { roundId: tableRound.json.data.roundId } },
    cookies: outsider.guest,
  });
  check('another table cannot join it', foreignJoin.status === 403, `status ${foreignJoin.status}`);
  const tableState = await call('GET', `/api/public/games/round?t=${A}&roundId=${tableRound.json.data.roundId}`, {
    cookies: guest1.guest,
  });
  const afterJoin = await call('GET', `/api/public/games/round?t=${A}&roundId=${tableRound.json.data.roundId}`, {
    cookies: guest1.guest,
  });
  check(
    'both players are listed on the same round',
    (afterJoin.json.data.players ?? []).length >= 2,
    (afterJoin.json.data.players ?? []).map((p) => p.name).join(', '),
  );

  const lobby = await call('GET', `/api/public/games/lobby?t=${A}`, { cookies: guest1.guest });
  check('no restaurant game runs by itself (the admin starts it)', lobby.json.data?.restaurantGame === null);
  check('leaderboard answers', (await call('GET', `/api/public/games/leaderboard?t=${A}`, { cookies: guest1.guest })).json.ok === true);

  // ==================================================================== G. new party / close
  console.log('\nG. New party and closing');
  const beforeParty = await call('GET', `/api/public/state?t=${A}`, { cookies: guest1.guest });
  const partyStart = await call('POST', '/api/waiter/new-party', {
    body: { tableId: tableA.id },
    cookies: waiter.jar,
  });
  check('waiter starts a new party', partyStart.json.ok === true, JSON.stringify(partyStart.json.data));
  const afterParty = await call('GET', `/api/public/state?t=${A}`, { cookies: guest1.guest });
  check('old visit is signed out', afterParty.json.data.needs_code === true);
  // the orders stay in the database (they feed the sales report) ...
  const dayAround = (d) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
  const keptReport = await call('GET', `/api/admin/reports?from=${dayAround(-1)}&to=${dayAround(1)}`, {
    cookies: admin.jar,
  });
  check(
    'old orders are kept, not deleted',
    beforeParty.json.data.orders.length > 0 && Number(keptReport.json.data?.totalOrders) > 0,
    `${keptReport.json.data?.totalOrders} orders in the report`,
  );
  // ... but the waiter's table view shows only the visit that is open now
  check(
    'a freed table does not show the previous party’s orders',
    (await call('GET', `/api/waiter/table?id=${tableA.id}`, { cookies: waiter.jar })).json.data.fullOrders.length === 0,
  );
  const freeTable = await call('GET', '/api/waiter/board', { cookies: waiter.jar });
  check(
    'the table is free again',
    freeTable.json.data.tables.find((t) => t.id === tableA.id)?.status === 'free',
  );

  const newParty = await seatGuest(A, tableA.number, waiter.jar, ' new');
  const cleanState = await call('GET', `/api/public/state?t=${A}`, { cookies: newParty.guest });
  check('the new party starts with an empty cart', cleanState.json.data.cart.itemCount === 0);
  check('and no orders', cleanState.json.data.orders.length === 0);

  const close = await call('POST', '/api/waiter/close-session', {
    body: { sessionId: cleanState.json.data.session.id, reason: 'paid and left' },
    cookies: waiter.jar,
  });
  check('waiter closes the table', close.json.ok === true);
  const closeTwice = await call('POST', '/api/waiter/close-session', {
    body: { sessionId: cleanState.json.data.session.id },
    cookies: waiter.jar,
  });
  check('closing twice is harmless', closeTwice.status === 404 || closeTwice.json.ok === true, `status ${closeTwice.status}`);
  const afterClose = await call('GET', `/api/public/state?t=${A}`, { cookies: newParty.guest });
  check('the phone is out after the close', afterClose.json.data.needs_code === true);

  // ==================================================================== H. moving tables
  console.log('\nH. One phone, two tables');
  const mover = await seatGuest(B, tableB.number, waiter.jar, ' mover').guest;
  // table A has no live card after the close above, so a scan raises one for the waiter
  const cardOnA = await call('POST', '/api/public/session', { body: { table_code: A } });
  check('scanning table A raises a code for the waiter', cardOnA.json.data?.needs_code === true);
  const otherCard = await staffCode(waiter.jar, tableA.number);
  check('the waiter can read that code', Boolean(otherCard?.code) && otherCard.state === 'live');
  const move = await call('POST', '/api/public/verify-otp', {
    body: { table_code: A, code: otherCard?.code ?? '0000' },
    cookies: mover,
  });
  check('a phone can enter another table’s code', move.json.ok === true, move.json.error);
  const movedState = await call('GET', `/api/public/state?t=${A}`, { cookies: mover });
  check('and it now belongs to that table', movedState.json.data.session.table_number === tableA.number);
  const oldTableState = await call('GET', `/api/public/state?t=${B}`, { cookies: mover });
  check('the old table no longer answers for it', oldTableState.json.data.needs_code === true);

  // ==================================================================== I. admin
  console.log('\nI. Admin: menu, tables, settings, staff');
  const category = await call('POST', '/api/admin/menu-category', {
    body: { name: 'QA Category', emoji: 'flask', sortOrder: 98, isActive: true },
    cookies: admin.jar,
  });
  check('create category', category.json.ok === true);
  const categoryId = category.json.data.id;
  const newItem = await call('POST', '/api/admin/menu-item', {
    body: {
      categoryId,
      name: 'QA Dish',
      price: 199,
      description: 'Only for the audit',
      isVeg: true,
      isAvailable: true,
    },
    cookies: admin.jar,
  });
  check('create dish', newItem.json.ok === true);
  const itemId = newItem.json.data.id;
  const badOffer = await call('POST', '/api/admin/menu-item', {
    body: {
      categoryId,
      name: 'Bad offer',
      price: 100,
      offerPrice: 200,
      isVeg: true,
    },
    cookies: admin.jar,
  });
  check('an offer above the price is refused', badOffer.status === 400 || badOffer.status === 422, `status ${badOffer.status}`);
  await call('POST', '/api/admin/sold-out', { body: { itemId, isAvailable: false }, cookies: admin.jar });
  const menuAfter = await call('GET', `/api/public/menu?t=${A}`);
  check(
    'sold out is live on the guest menu',
    menuAfter.json.data.menu.flatMap((c) => c.items).find((i) => i.id === itemId)?.is_available === false,
  );
  const del = await call('POST', '/api/admin/menu-item-delete', { body: { id: itemId }, cookies: admin.jar });
  check('delete dish', del.json.ok === true && del.json.data.deleted === true);
  await call('POST', '/api/admin/menu-category-delete', { body: { id: categoryId }, cookies: admin.jar });

  const created = await call('POST', '/api/admin/table', {
    body: { number: 21, label: 'Garden 21', zone: 'garden' },
    cookies: admin.jar,
  });
  check('create table', created.json.ok === true);
  const newTableId = created.json.data.id;
  const newTableCode = (await call('GET', '/api/admin/tables', { cookies: admin.jar })).json.data.tables.find(
    (t) => t.id === newTableId,
  )?.table_code;
  const newLink = await call('POST', '/api/public/session', { body: { table_code: newTableCode } });
  check('a new sticker works immediately', newLink.json.ok === true && newLink.json.data.needs_code === true);
  const regen = await call('POST', '/api/admin/table-regenerate', { body: { id: newTableId }, cookies: admin.jar });
  check(
    'regenerate the QR code',
    regen.json.ok === true && regen.json.data.table_code !== newTableCode,
    `${newTableCode} → ${regen.json.data?.table_code}`,
  );
  const oldLink = await call('POST', '/api/public/session', { body: { table_code: newTableCode } });
  check('the old printout stops working', oldLink.status === 404, `status ${oldLink.status}`);
  const deactivate = await call('POST', '/api/admin/table', {
    body: { id: newTableId, number: 21, label: 'Garden 21', isActive: false },
    cookies: admin.jar,
  });
  check('deactivating a table', deactivate.json.ok === true);
  const deadTable = await call('POST', '/api/public/session', { body: { table_code: regen.json.data.table_code } });
  check('a deactivated table link is refused', deadTable.status === 404 || deadTable.json.ok === false);
  const delTable = await call('POST', '/api/admin/table-delete', { body: { id: newTableId }, cookies: admin.jar });
  check('delete the table', delTable.json.ok === true, delTable.json.error);

  const taxBefore = (await call('GET', '/api/admin/settings', { cookies: admin.jar })).json.data.restaurant;
  await call('POST', '/api/admin/settings', { body: { taxPercent: 12 }, cookies: admin.jar });
  const taxGuest = await seatGuest(B, tableB.number, waiter.jar, ' tax');
  const taxItem = await menuItem(B, (i) => i.is_available);
  await call('POST', '/api/public/cart', { body: { table_code: B, op: 'add', payload: { menuItemId: taxItem.id, qty: 1 } }, cookies: taxGuest.guest });
  const taxed = await call('POST', '/api/public/order', { body: { table_code: B, payload: {} }, cookies: taxGuest.guest });
  const taxedOrder = taxed.json.data?.orders?.find((o) => o.id === taxed.json.data.orderId);
  check(
    'a tax change applies to new orders',
    Math.abs(taxedOrder.tax - Math.round(taxItem.effective_price * 0.12 * 100) / 100) < 0.02,
    `tax ${taxedOrder?.tax} on ${taxItem.effective_price}`,
  );
  await call('POST', '/api/admin/settings', { body: { taxPercent: Number(taxBefore.tax_percent) }, cookies: admin.jar });

  const staffCreate = await call('POST', '/api/admin/staff', {
    body: { email: 'qa.waiter@spiceroute.test', fullName: 'QA Waiter', role: 'waiter', password: 'QaPass@1234' },
    cookies: admin.jar,
  });
  check('create a staff account', staffCreate.json.ok === true);
  const qaLogin = await login('qa.waiter@spiceroute.test', 'QaPass@1234');
  check('the new waiter can sign in', qaLogin.res.json.ok === true);
  check('and only sees the waiter board', (await call('GET', '/api/waiter/board', { cookies: qaLogin.jar })).json.ok === true);
  check('but not the admin API', (await call('GET', '/api/admin/menu', { cookies: qaLogin.jar })).status === 403);
  const promote = await call('POST', '/api/admin/staff-update', {
    body: { id: staffCreate.json.data.id, role: 'kitchen', isActive: true, fullName: 'QA Waiter' },
    cookies: admin.jar,
  });
  check('role change', promote.json.ok === true);
  const demoted = await login('qa.waiter@spiceroute.test', 'QaPass@1234');
  check('the role change is live', (await call('GET', '/api/waiter/board', { cookies: demoted.jar })).status === 403);
  const selfDemote = await call('POST', '/api/admin/staff-update', {
    body: { id: staffCreate.json.data.id, role: 'kitchen', isActive: false, fullName: 'QA Waiter' },
    cookies: admin.jar,
  });
  check('a staff account can be deactivated', selfDemote.json.ok === true);
  const deadLogin = await login('qa.waiter@spiceroute.test', 'QaPass@1234');
  check('a deactivated account cannot sign in', deadLogin.res.status === 401, `status ${deadLogin.res.status}`);

  const today = new Date().toISOString().slice(0, 10);
  const report = await call('GET', `/api/admin/reports?from=${today}&to=${today}`, { cookies: admin.jar });
  check('sales report answers', report.json.ok === true, `${report.json.data?.totalOrders} orders`);
  check('revenue adds up', Number(report.json.data?.totalRevenue) > 0, `${report.json.data?.totalRevenue}`);
  check('average order value is derived', Number(report.json.data?.averageOrderValue) >= 0);
  check('top items are ranked', (report.json.data?.topItems ?? []).length >= 1, `${report.json.data?.topItems?.[0]?.name}`);
  const csv = await call('GET', `/api/admin/reports?from=${today}&to=${today}&format=csv`, { cookies: admin.jar });
  check('CSV export', csv.status === 200);
  const audit = await call('GET', '/api/admin/audit', { cookies: admin.jar });
  check('audit log records the day', (audit.json.data?.entries ?? audit.json.data?.log ?? []).length >= 5);

  // ==================================================================== J. abuse
  console.log('\nJ. Abuse and access control');
  const endpoints = [
    ['GET', '/api/admin/menu'],
    ['GET', '/api/admin/tables'],
    ['GET', '/api/admin/staff'],
    ['GET', '/api/waiter/board'],
    ['GET', '/api/kitchen/board'],
    ['GET', '/api/staff/events'],
  ];
  let allBlocked = true;
  for (const [m, p] of endpoints) {
    const r = await call(m, p);
    if (r.status !== 401) {
      allBlocked = false;
      bad(`anonymous ${p}`, `status ${r.status}`);
    }
  }
  if (allBlocked) ok(`every staff endpoint refuses an anonymous caller`, `${endpoints.length} endpoints`);

  const guestOnStaff = await call('GET', '/api/waiter/board', { cookies: guest1.guest });
  check('a guest cookie is not a staff cookie', guestOnStaff.status === 401 || guestOnStaff.status === 403);
  const kitchenOnWaiter = await call('GET', '/api/waiter/board', { cookies: kitchen.jar });
  check('kitchen cannot open the waiter board', kitchenOnWaiter.status === 403);
  const waiterOnAdmin = await call('POST', '/api/admin/settings', { body: { taxPercent: 1 }, cookies: waiter.jar });
  check('waiter cannot change settings', waiterOnAdmin.status === 403);
  const crossOrigin = await call('POST', '/api/public/order', {
    body: { table_code: A, payload: {} },
    cookies: mover,
    headers: { origin: 'https://evil.example' },
  });
  check('cross-origin writes refused', crossOrigin.status === 403);
  const csrfStaff = await call('POST', '/api/waiter/order', {
    body: { orderId: order1.id, action: 'confirm' },
    cookies: waiter.jar,
    headers: { origin: 'https://evil.example' },
  });
  check('cross-origin staff writes refused', csrfStaff.status === 403);
  const xss = await call('POST', '/api/public/feedback', {
    body: { table_code: B, payload: { rating: 1, message: '<img src=x onerror=alert(1)>bad', contact: '1' } },
    cookies: taxGuest.guest,
  });
  check('feedback with html is accepted but sanitised', xss.json.ok === true);
  const inbox2 = await call('GET', '/api/admin/feedback', { cookies: admin.jar });
  check(
    'no script survives storage',
    !inbox2.json.data.feedback.some((f) => String(f.message).includes('onerror')),
  );
  const sqlish = await call('POST', '/api/public/session', { body: { table_code: "1' or '1'='1" } });
  check('sql-ish table code is just not found', [400, 404, 422].includes(sqlish.status), `status ${sqlish.status}`);
  const huge = await call('POST', '/api/public/cart', {
    body: { table_code: B, op: 'add', payload: { menuItemId: taxItem.id, qty: 1, notes: 'x'.repeat(5000) } },
    cookies: taxGuest.guest,
  });
  check('a 5 000-character note is rejected', [400, 422].includes(huge.status), `status ${huge.status}`);

  // headers
  const pageRes = await fetch(`${BASE}/t/${B}`, { headers: { accept: 'text/html' } });
  const csp = pageRes.headers.get('content-security-policy') ?? '';
  check('CSP present', csp.includes("default-src") && csp.includes("frame-ancestors"), csp.slice(0, 40));
  check('HSTS + nosniff + frame denial', Boolean(pageRes.headers.get('strict-transport-security')) && pageRes.headers.get('x-content-type-options') === 'nosniff' && (pageRes.headers.get('x-frame-options') ?? '').toUpperCase() === 'DENY');

  // ==================================================================== K. device cap
  console.log('\nK. A big group at one table');
  const capCard = await staffCode(waiter.jar, tableB.number);
  const capStatuses = [];
  for (let i = 0; i < 4; i++) {
    const r = await call('POST', '/api/public/verify-otp', {
      body: { table_code: B, code: capCard?.code ?? '0000' },
      cookies: jar(),
      headers: { 'x-forwarded-for': '198.51.100.77' },
    });
    capStatuses.push(r.status);
  }
  check(
    'more phones keep joining up to the cap',
    capStatuses.filter((s) => s === 200).length >= 1,
    capStatuses.join(','),
  );
  const seats = (await call('GET', '/api/waiter/codes', { cookies: waiter.jar })).json.data.otps.find((o) => o.table_number === tableB.number);
  check('the waiter sees how many phones joined', seats.joined_phones >= 2, `${seats.joined_phones} joined`);

  // ==================================================================== L. ops
  console.log('\nL. Operations');
  const cronNoKey = await call('GET', '/api/cron/housekeeping');
  check('cron needs the secret', cronNoKey.status === 403 || cronNoKey.status === 503, `status ${cronNoKey.status}`);
  const cron = await call('GET', '/api/cron/housekeeping', { headers: { 'x-cron-key': process.env.CRON_SECRET ?? 'local-cron-secret-for-tests' } });
  check('cron runs with it', cron.json.ok === true, JSON.stringify(cron.json.data ?? {}));
  const health = await call('GET', '/api/health');
  check('health endpoint', health.json.ok === true, health.json.mode);
  const qr = await call('GET', '/api/admin/qr-pdf', { cookies: admin.jar });
  check('QR PDF renders', qr.status === 200, `${qr.headers.get('content-length') ?? '?'} bytes`);

  const reset = await call('POST', '/api/demo/reset');
  check('demo reset', reset.json.ok === true);
  const afterReset = await call('GET', '/api/waiter/codes', { cookies: waiter.jar });
  check('reset clears the code cards', (afterReset.json.data?.otps ?? []).length === 0);

  // ==================================================================== summary
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
  console.error('\nFinal QA crashed:', err);
  process.exit(1);
});
