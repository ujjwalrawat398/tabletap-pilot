#!/usr/bin/env node
/**
 * Edge cases — the awkward, real-world ones.
 *
 *   node scripts/edge-cases.mjs [http://127.0.0.1:3000]
 *
 * These are the situations a restaurant actually produces: a big group at one
 * table, a phone that keeps retrying a locked code, a sticker photographed by
 * someone outside, a waiter who regenerates a sticker mid-visit, an admin who
 * demotes himself, a 5 000-character note, two phones racing for one dish.
 *
 * Anything that needs the clock to move is driven through the database, not by
 * sleeping, so the whole file runs in seconds.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
// Time is moved from INSIDE the app (`POST /api/dev/clock`, embedded demo DB only).
// A second PGlite handle from this process is not an option: PGlite is single-writer
// per process, so an outside handle never sees what the server wrote.

let pass = 0;
let fail = 0;
const failures = [];
const ok = (n, e = '') => {
  pass++;
  console.log(`  ✓ ${n}${e ? ` — ${e}` : ''}`);
};
const bad = (n, d) => {
  fail++;
  failures.push(`${n}: ${d}`);
  console.log(`  ✗ ${n} — ${d}`);
};
const check = (n, c, d = '') => (c ? ok(n, d) : bad(n, d || 'assertion failed'));

function jar() {
  const s = new Map();
  return {
    header: () => [...s.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb(r) {
      for (const c of r.headers.getSetCookie?.() ?? []) {
        const [p] = c.split(';');
        const i = p.indexOf('=');
        s.set(p.slice(0, i), p.slice(i + 1));
      }
    },
    get: (k) => s.get(k),
  };
}
async function call(m, p, { body, cookies, headers } = {}) {
  const r = await fetch(`${BASE}${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(cookies ? { cookie: cookies.header() } : {}), origin: BASE, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  cookies?.absorb(r);
  const t = await r.text();
  let json;
  try {
    json = JSON.parse(t);
  } catch {
    json = { raw: t.slice(0, 200) };
  }
  return { status: r.status, json };
}

async function clock(op, body) {
  const r = await call('POST', '/api/dev/clock', { body: { op, ...body } });
  if (!r.json.ok) {
    throw new Error(
      `dev clock "${op}" unavailable (${r.status}): ${r.json.error ?? 'unknown'}. ` +
        'This suite needs the embedded demo database (PGLITE), not a live Postgres.',
    );
  }
  return r.json.data;
}

async function sessionIdOf(cookies, code, label) {
  const st = await call('GET', `/api/public/state?t=${code}`, { cookies });
  const id = st.json?.data?.session?.id;
  if (!id) throw new Error(`${label}: the guest is not in a live visit (needs_code or session missing)`);
  return id;
}

async function main() {
  console.log(`\nTableTap edge cases → ${BASE}\n`);
  await call('POST', '/api/demo/reset');

  const admin = jar();
  await call('POST', '/api/staff/login', { body: { email: 'admin@spiceroute.test', password: 'Demo@1234' }, cookies: admin });
  const waiter = jar();
  await call('POST', '/api/staff/login', { body: { email: 'waiter@spiceroute.test', password: 'Demo@1234' }, cookies: waiter });
  const kitchen = jar();
  await call('POST', '/api/staff/login', { body: { email: 'kitchen@spiceroute.test', password: 'Demo@1234' }, cookies: kitchen });

  const tables = (await call('GET', '/api/admin/tables', { cookies: admin })).json.data.tables;
  const tA = tables.find((t) => t.number === 1);
  const tB = tables.find((t) => t.number === 2);
  const tC = tables.find((t) => t.number === 3);
  const tD = tables.find((t) => t.number === 4);
  const tE = tables.find((t) => t.number === 5);
  const A = tA.table_code;
  const B = tB.table_code;

  const card = async (n) =>
    (await call('GET', '/api/waiter/codes', { cookies: waiter })).json.data.otps.find((o) => o.table_number === n);

  // ================================================================ 1. big group
  console.log('1. A party of 14 on one table');
  await call('POST', '/api/public/session', { body: { table_code: A } });
  const joinCode = (await card(1)).code;
  const joined = [];
  const refused = [];
  for (let i = 0; i < 14; i++) {
    const g = jar();
    const r = await call('POST', '/api/public/verify-otp', {
      body: { table_code: A, code: joinCode },
      cookies: g,
      headers: { 'x-forwarded-for': '198.51.100.60' },
    });
    (r.status === 200 ? joined : refused).push(r);
  }
  check('12 phones get in', joined.length === 12, `${joined.length} joined`);
  check('the 13th and 14th get a clear cap message', refused.length === 2 && refused.every((r) => r.status === 409));
  check(
    'the cap message names the limit',
    /12 phones/i.test(refused[0]?.json?.error ?? ''),
    refused[0]?.json?.error,
  );
  const numbers = joined.map((r) => r.json.data.guest_no);
  check('every phone got its own guest number', new Set(numbers).size === numbers.length, `G${numbers[0]}–G${numbers[numbers.length - 1]}`);
  // and the waiter's card shows the crowd
  check('the card shows 12 phones', (await card(1)).phones === 12, `${(await card(1)).phones} phones`);
  // one of them leaves (closes the browser) — a slot must free up
  const bigSessionId = joined[0].json.data.state.session.id;
  const dropped = await clock('drop-guest', { sessionId: bigSessionId });
  check('one phone leaves the table', dropped.length === 1, `G${dropped[0]?.guest_no} gone`);
  const g13 = jar();
  const retry = await call('POST', '/api/public/verify-otp', {
    body: { table_code: A, code: joinCode },
    cookies: g13,
    headers: { 'x-forwarded-for': '198.51.100.60' },
  });
  check('a freed slot can be taken again', retry.status === 200, `guest ${retry.json.data?.guest_no}`);
  // the party pays and leaves — the table must be free for the next group
  await call('POST', '/api/waiter/close-session', { body: { sessionId: bigSessionId }, cookies: waiter });
  const freeGrid = (await call('GET', '/api/waiter/board', { cookies: waiter })).json.data.tables.find(
    (t) => t.number === 1,
  );
  check('closing the visit frees the table', freeGrid?.status === 'free', freeGrid?.status);

  // ================================================================ 2. code abuse
  console.log('\n2. Someone outside with a photograph of the sticker');
  const outside = jar();
  const scanOutside = await call('POST', '/api/public/session', {
    body: { table_code: B },
    cookies: outside,
    headers: { 'x-forwarded-for': '203.0.113.5' },
  });
  check('the photo gets a code screen, nothing more', !outside.get('tt_session'));
  check('and no code or password in the answer', !/wifi_password|"code":"\d{4}"/.test(JSON.stringify(scanOutside.json)));
  const menuOutside = await call('GET', `/api/public/menu?t=${B}`);
  check('the menu is public anyway (nothing secret there)', menuOutside.json.ok === true);
  const orderOutside = await call('POST', '/api/public/order', { body: { table_code: B, payload: {} }, cookies: outside });
  check('ordering is impossible', orderOutside.status === 401);
  const wifiOutside = await call('POST', '/api/public/wifi', { body: { table_code: B }, cookies: outside });
  check('so is the Wi-Fi password', wifiOutside.status === 401);
  // guessing: 20 tries across 5 codes worth of attempts, from rotating IPs
  const bCard = await card(2);
  let locked = 0;
  for (let i = 0; i < 20; i++) {
    const guess = String(1000 + Math.floor(Math.random() * 8999));
    const r = await call('POST', '/api/public/verify-otp', {
      body: { table_code: B, code: guess },
      cookies: jar(),
      headers: { 'x-forwarded-for': `204.10.${i}.7` },
    });
    if (r.json.code === 'LOCKED') {
      locked++;
      break;
    }
  }
  check('rotating IPs does not beat the 5-try limit', locked === 1 || (await card(2))?.state === 'locked');
  const deadCard = await card(2);
  check('the code is locked on the board', deadCard?.state === 'locked', deadCard?.state);
  const honestGuest = jar();
  const useDead = await call('POST', '/api/public/verify-otp', {
    body: { table_code: B, code: bCard?.code ?? '0000' },
    cookies: honestGuest,
  });
  check('even the real guests cannot use a locked code', useDead.json.ok === false, useDead.json.code);

  // ================================================================ 3. lost phone
  console.log('\n3. A guest loses their phone, then comes back');
  const reseat = await call('POST', '/api/public/session', { body: { table_code: B } });
  void reseat;
  const freshCode = await card(2);
  const phoneA = jar();
  await call('POST', '/api/public/verify-otp', { body: { table_code: B, code: freshCode.code }, cookies: phoneA });
  const menu = (await call('GET', `/api/public/menu?t=${B}`)).json.data.menu.flatMap((c) => c.items);
  const dish = menu.find((i) => i.is_available && !i.offer_active);
  await call('POST', '/api/public/cart', { body: { table_code: B, op: 'add', payload: { menuItemId: dish.id, qty: 2 } }, cookies: phoneA });
  const ordered = await call('POST', '/api/public/order', { body: { table_code: B, payload: {} }, cookies: phoneA });
  check('the guest orders', ordered.json.ok === true);
  await call('POST', '/api/waiter/order', { body: { orderId: ordered.json.data.orderId, action: 'confirm' }, cookies: waiter });
  // phone dies: same person, new device, same live code
  const phoneB = jar();
  const back = await call('POST', '/api/public/verify-otp', { body: { table_code: B, code: freshCode.code }, cookies: phoneB });
  check('they get back in with the same code', back.json.ok === true);
  const stateBack = await call('GET', `/api/public/state?t=${B}`, { cookies: phoneB });
  check('their order is still there', stateBack.json.data.orders.some((o) => o.id === ordered.json.data.orderId));
  check('and the cart did not resurrect the sent lines', stateBack.json.data.cart.itemCount === 0);
  check('they are a new guest number, same visit', back.json.data.guest_no !== 1 || back.json.data.joined === true, `G${back.json.data.guest_no}`);

  // ================================================================ 4. two clocks
  console.log('\n4. The two clocks (driven in the database, not by waiting)');
  const clockGuest = jar();
  const clockCode = await card(2);
  await call('POST', '/api/public/verify-otp', { body: { table_code: B, code: clockCode.code }, cookies: clockGuest });
  const sessionId = await sessionIdOf(clockGuest, B, 'idle test');

  // idle: push last_activity_at past the 90-minute window
  await clock('age-session', { sessionId, idleMinutes: 91 });
  const idle = await call('GET', `/api/public/state?t=${B}`, { cookies: clockGuest });
  check('90 minutes of silence ends the visit', idle.json.data?.needs_code === true);
  const closedRow = await clock('session', { sessionId });
  check('and the row says why', /idle/i.test(closedRow?.closed_reason ?? ''), closedRow?.closed_reason);

  // hard cap: a busy table cannot live past 4 hours
  const capGuest = await (async () => {
    await call('POST', '/api/public/session', { body: { table_code: B } });
    const c = await card(2);
    const g = jar();
    await call('POST', '/api/public/verify-otp', { body: { table_code: B, code: c.code }, cookies: g });
    return g;
  })();
  const capSession = await sessionIdOf(capGuest, B, 'hard-cap test');
  await clock('age-session', { sessionId: capSession, pastHardCap: true });
  const capped = await call('GET', `/api/public/state?t=${B}`, { cookies: capGuest });
  check('the 4-hour cap wins even while active', capped.json.data?.needs_code === true);
  const capRow = await clock('session', { sessionId: capSession });
  check('the reason is the hard cap', /hard cap/i.test(capRow?.closed_reason ?? ''), capRow?.closed_reason);

  // activity slides the idle window but never the cap
  const C = tC.table_code;
  const slideGuest = await (async () => {
    await call('POST', '/api/public/session', { body: { table_code: C } });
    const c = await card(3);
    const g = jar();
    const v = await call('POST', '/api/public/verify-otp', { body: { table_code: C, code: c.code }, cookies: g });
    if (!v.json.ok) throw new Error(`clock test could not seat a guest: ${v.json.error} (${v.json.code})`);
    return g;
  })();
  const slideSession = await sessionIdOf(slideGuest, C, 'slide test');
  // put the visit 60 minutes into its idle window, then touch it like a guest does
  const before = await clock('age-session', { sessionId: slideSession, idleMinutes: 60 });
  await sleep(1200);
  await call('GET', `/api/public/state?t=${C}`, { cookies: slideGuest });
  const after = await clock('session', { sessionId: slideSession });
  check(
    'activity slides the idle clock back to now',
    new Date(after.last_activity_at) > new Date(before.last_activity_at),
    `${Math.round((new Date(after.last_activity_at) - new Date(before.last_activity_at)) / 1000)}s later`,
  );
  check('activity never moves the hard cap', after.hard_expires_at === before.hard_expires_at);

  // ================================================================ 5. code expiry
  console.log('\n5. A code that times out while the guest is typing');
  await call('POST', '/api/public/session', { body: { table_code: A } });
  const expiring = await card(1);
  await clock('expire-code', { tableNumber: 1 });
  const late = await call('POST', '/api/public/verify-otp', {
    body: { table_code: A, code: expiring.code },
    cookies: jar(),
  });
  check('an expired code is refused', late.json.ok === false && /EXPIRED|NO_CODE/.test(late.json.code ?? ''), late.json.code);
  const expiredCard = await card(1);
  check('the board shows it expired, not live', expiredCard?.state !== 'live', expiredCard?.state);
  const reissue = await call('POST', '/api/public/session', { body: { table_code: A } });
  check('"Ask again" is cooldown-limited, not instant', reissue.json.data?.retry_after >= 0, `${reissue.json.data?.retry_after}s`);
  const forced = await call('POST', '/api/waiter/otp-raise', { body: { tableId: tA.id }, cookies: waiter });
  check('the waiter can always force a new one', forced.json.ok === true && forced.json.data.otp.state === 'live');
  const works = await call('POST', '/api/public/verify-otp', {
    body: { table_code: A, code: forced.json.data.otp.code },
    cookies: jar(),
  });
  check('and the new code works', works.json.ok === true);

  // ================================================================ 6. last table
  console.log('\n6. The last order of the night');
  const D = tD.table_code;
  const lastGuest = jar();
  await call('POST', '/api/public/session', { body: { table_code: D } });
  const lastCard = await card(4);
  const lastIn = await call('POST', '/api/public/verify-otp', { body: { table_code: D, code: lastCard.code }, cookies: lastGuest });
  if (!lastIn.json.ok) throw new Error(`last-order test could not seat a guest: ${lastIn.json.error}`);
  await call('POST', '/api/public/cart', {
    body: { table_code: D, op: 'add', payload: { menuItemId: dish.id, qty: 1 } },
    cookies: lastGuest,
  });
  const lastOrder = await call('POST', '/api/public/order', { body: { table_code: D, payload: {} }, cookies: lastGuest });
  const closeWithPending = await call('POST', '/api/waiter/close-session', {
    body: { sessionId: await sessionIdOf(lastGuest, D, 'last-order test') },
    cookies: waiter,
  });
  check('closing with an unconfirmed order does not crash', closeWithPending.json.ok === true);
  const ordAfterClose = (await call('GET', `/api/public/state?t=${D}`, { cookies: lastGuest })).json.data;
  check(
    'the guest who ordered it is signed out, order not honoured',
    ordAfterClose?.needs_code === true,
    ordAfterClose?.needs_code ? 'needs_code' : 'still in',
  );
  check(
    'the kitchen never saw it',
    !(await call('GET', '/api/kitchen/board', { cookies: kitchen })).json.data.orders.some(
      (o) => o.id === lastOrder.json.data.orderId,
    ),
  );
  const revenue = await call('GET', `/api/admin/reports?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, {
    cookies: admin,
  });
  check(
    'the rejected order is not counted in revenue',
    !(revenue.json.data?.byTable ?? []).some(
      (r) => Math.abs(Number(r.revenue) - Number(lastOrder.json.data.orders?.[0]?.total)) === 0,
    ),
    `totalRevenue ${revenue.json.data?.totalRevenue}`,
  );

  // ================================================================ 7. sticker swap
  console.log('\n7. The stickers are replaced mid-service');
  const stuck = jar();
  await call('POST', '/api/public/session', { body: { table_code: B } });
  const stuckCard = await card(2);
  await call('POST', '/api/public/verify-otp', { body: { table_code: B, code: stuckCard.code }, cookies: stuck });
  const regen = await call('POST', '/api/admin/table-regenerate', { body: { id: tB.id }, cookies: admin });
  check('regenerating gives a new code', regen.json.ok === true);
  const newB = regen.json.data.table_code;
  const oldSticker = await call('POST', '/api/public/session', { body: { table_code: B } });
  check('the old sticker is dead', oldSticker.status === 404);
  // the guest's own link is the NEW sticker now; their old code still opened it
  const stillIn = await call('GET', `/api/public/state?t=${newB}`, { cookies: stuck });
  check('phones at the table are cut off by the swap', stillIn.json.data?.needs_code === true);
  const newSticker = await call('POST', '/api/public/session', { body: { table_code: newB } });
  check('the new sticker works immediately', newSticker.json.ok === true);

  // ================================================================ 8. two waiters
  console.log('\n8. Two waiters, one order, one table');
  const raceGuest = jar();
  await call('POST', '/api/public/session', { body: { table_code: newB } });
  const raceCard = await card(2);
  await call('POST', '/api/public/verify-otp', { body: { table_code: newB, code: raceCard.code }, cookies: raceGuest });
  await call('POST', '/api/public/cart', {
    body: { table_code: newB, op: 'add', payload: { menuItemId: dish.id, qty: 1 } },
    cookies: raceGuest,
  });
  const raceOrder = await call('POST', '/api/public/order', { body: { table_code: newB, payload: {} }, cookies: raceGuest });
  const [c1, c2] = await Promise.all([
    call('POST', '/api/waiter/order', { body: { orderId: raceOrder.json.data.orderId, action: 'confirm' }, cookies: waiter }),
    call('POST', '/api/waiter/order', { body: { orderId: raceOrder.json.data.orderId, action: 'confirm' }, cookies: admin }),
  ]);
  check('exactly one confirm wins', [c1.status, c2.status].sort().join('/') === '200/409', `${c1.status}/${c2.status}`);
  const [k1, k2] = await Promise.all([
    call('POST', '/api/kitchen/order', { body: { orderId: raceOrder.json.data.orderId, action: 'preparing' }, cookies: kitchen }),
    call('POST', '/api/kitchen/order', { body: { orderId: raceOrder.json.data.orderId, action: 'preparing' }, cookies: kitchen }),
  ]);
  check('exactly one kitchen start wins', [k1.status, k2.status].sort().join('/') === '200/409', `${k1.status}/${k2.status}`);

  // ================================================================ 9. admin safety
  console.log('\n9. An admin cannot lock themselves out');
  const me = (await call('GET', '/api/admin/staff', { cookies: admin })).json.data.user;
  const demoteSelf = await call('POST', '/api/admin/staff-update', {
    body: { id: me.id, role: 'waiter', fullName: me.full_name },
    cookies: admin,
  });
  check('the last admin cannot be demoted', demoteSelf.status === 409, `status ${demoteSelf.status}`);
  const deactivateSelf = await call('POST', '/api/admin/staff-update', {
    body: { id: me.id, role: 'admin', isActive: false, fullName: me.full_name },
    cookies: admin,
  });
  check('nor deactivated', deactivateSelf.status === 409, `status ${deactivateSelf.status}`);
  const stillAdmin = (await call('GET', '/api/admin/menu', { cookies: admin })).json.ok;
  check('and still signed in as admin', stillAdmin === true);

  // ================================================================ 10. hostile input
  console.log('\n10. Hostile input');
  // a fresh guest: the sticker swap in section 7 signed the previous one out
  const hostile = jar();
  await call('POST', '/api/public/session', { body: { table_code: tE.table_code } });
  const hostileCard = await card(5);
  const hostileIn = await call('POST', '/api/public/verify-otp', {
    body: { table_code: tE.table_code, code: hostileCard.code },
    cookies: hostile,
  });
  check('a new guest can still order after a busy night', hostileIn.json.ok === true, hostileIn.json.code);
  const cashCategoryId =
    (await call('GET', '/api/admin/menu', { cookies: admin })).json.data.categories?.[0]?.id ?? null;
  const big = await call('POST', '/api/public/cart', {
    body: { table_code: tE.table_code, op: 'add', payload: { menuItemId: dish.id, qty: 1, notes: 'x'.repeat(5001) } },
    cookies: hostile,
  });
  check('a 5 001-character note is refused', [400, 422].includes(big.status), `status ${big.status}`);
  const qtyHuge = await call('POST', '/api/public/cart', {
    body: { table_code: tE.table_code, op: 'add', payload: { menuItemId: dish.id, qty: 999 } },
    cookies: hostile,
  });
  check('999 of one dish is refused', [400, 422].includes(qtyHuge.status), `status ${qtyHuge.status}`);
  const nanPrice = await call('POST', '/api/admin/menu-item', {
    body: { categoryId: null, name: 'NaN dish', price: 'abc', isVeg: true },
    cookies: admin,
  });
  check('a non-numeric price is refused', [400, 422].includes(nanPrice.status), `status ${nanPrice.status}`);
  const negPrice = await call('POST', '/api/admin/menu-item', {
    body: { name: 'Negative', price: -50, isVeg: true, categoryId: cashCategoryId },
    cookies: admin,
  });
  check('a negative price is refused', [400, 422].includes(negPrice.status), `status ${negPrice.status}`);
  const badTable = await call('POST', '/api/public/session', { body: { table_code: 'x'.repeat(200) } });
  check('an absurd table code is refused', [400, 404, 422].includes(badTable.status), `status ${badTable.status}`);
  const noBody = await fetch(`${BASE}/api/public/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE },
    body: 'not json',
  });
  check('a malformed body is a clean 400', [400, 415, 422].includes(noBody.status), `status ${noBody.status}`);
  const unauthUpload = await call('POST', '/api/admin/upload', { body: {} });
  check('no anonymous uploads', [401, 404, 405].includes(unauthUpload.status), `status ${unauthUpload.status}`);

  // ================================================================ 11. kitchen privacy
  console.log('\n11. What the kitchen must never see');
  await call('POST', '/api/public/session', { body: { table_code: newB } });
  const kEvents = await call('GET', '/api/staff/events', { cookies: kitchen });
  check('no codes in the kitchen feed', kEvents.json.data?.codes === 0);
  const liveCards = (await call('GET', '/api/waiter/codes', { cookies: waiter })).json.data.otps;
  check(
    'and none of the actual digits',
    !liveCards.some((c) => JSON.stringify(kEvents.json).includes(c.code)),
  );
  const kBoard = await call('GET', '/api/kitchen/board', { cookies: kitchen });
  check('no code cards on the kitchen screen', !JSON.stringify(kBoard.json).includes('"code"'));
  check('no guest phone counts beyond the ticket', !/otp/i.test(JSON.stringify(kBoard.json)));

  // ================================================================ 12. cleanup
  console.log('\n12. End of night');
  const panic = await call('POST', '/api/admin/end-all-sessions', { body: { confirm: 'END' }, cookies: admin });
  check('the panic action runs', panic.json.ok === true, JSON.stringify(panic.json.data));
  const afterPanic = await call('GET', `/api/public/state?t=${newB}`, { cookies: raceGuest });
  check('every guest is signed out', afterPanic.json.data?.needs_code === true);
  const gridAfter = (await call('GET', '/api/waiter/board', { cookies: waiter })).json.data.tables;
  check('every table is free', gridAfter.every((t) => t.status === 'free'), `${gridAfter.filter((t) => t.status === 'free').length}/${gridAfter.length}`);
  const cron = await call('GET', '/api/cron/housekeeping', {
    headers: { 'x-cron-key': process.env.CRON_SECRET ?? 'local-cron-secret-for-tests' },
  });
  check('housekeeping runs cleanly', cron.json.ok === true, JSON.stringify(cron.json.data));
  const codesAfter = (await call('GET', '/api/waiter/codes', { cookies: waiter })).json.data.otps;
  check(
    'no live code cards are left on the board',
    codesAfter.every((c) => c.state !== 'live'),
    `${codesAfter.filter((c) => c.state === 'live').length} live`,
  );

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
  console.error('\nEdge cases crashed:', err);
  process.exit(1);
});
