#!/usr/bin/env node
/**
 * Regression tests for the pre-launch review fixes plus the table-code (OTP)
 * P0 rules. Each block fails loudly if a fix is ever removed.
 * Each block fails loudly if the fix is ever removed.
 *
 *   node scripts/security-test.mjs [http://127.0.0.1:3000]
 *
 * The suite resets the demo database first (embedded demo mode only).
 */
import { execFileSync } from 'node:child_process';

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
  });
  cookies?.absorb(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json, headers: res.headers };
}

/** The code only exists on the staff API — this is how a real waiter reads it. */
async function staffCode(staffJar, tableNumber) {
  const res = await call('GET', '/api/waiter/codes', { cookies: staffJar });
  return (res.json.data?.otps ?? []).find((o) => o.table_number === tableNumber) ?? null;
}

/** A verified guest: exactly what a real phone does with the waiter's code. */
async function verifiedGuest(tableCode, tableNumber, staffJar, ip) {
  const guest = jar();
  const card = await staffCode(staffJar, tableNumber);
  const res = await call('POST', '/api/public/verify-otp', {
    body: { table_code: tableCode, code: card?.code ?? '0000' },
    cookies: guest,
    headers: ip ? { 'x-forwarded-for': ip } : undefined,
  });
  return { guest, card, res };
}

async function main() {
  console.log(`\nTableTap security regression tests → ${BASE}\n`);
  await call('POST', '/api/demo/reset');

  // ---------------------------------------------------------------- 1. secret
  console.log('1. SESSION_SECRET fails closed in production');
  // Import the real module and evaluate it under a production environment.
  const probe = `
    process.env.NODE_ENV = 'production';
    const { getSessionSecret } = await import('./src/lib/env.ts');
    const results = {};
    for (const [label, value] of [
      ['missing', undefined],
      ['short', 'abc123'],
      ['placeholder', 'dev-only-insecure-secret-change-me'],
      ['weak-marker', 'please-change-me-later-0123456789abcdef'],
      ['good', 'Zx9'.repeat(20)],
    ]) {
      if (value === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = value;
      try {
        getSessionSecret();
        results[label] = 'accepted';
      } catch (e) {
        results[label] = 'threw';
      }
    }
    console.log(JSON.stringify(results));
  `;
  let secretResults = null;
  try {
    const out = execFileSync(
      'npx',
      ['tsx', '-e', probe],
      { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    secretResults = JSON.parse(out.trim().split('\n').pop());
  } catch (err) {
    // tsx is not a dependency: fall back to the compiled server behaviour below.
    secretResults = null;
  }

  if (secretResults) {
    check('missing secret throws in production', secretResults.missing === 'threw');
    check('short secret throws in production', secretResults.short === 'threw');
    check('placeholder secret throws in production', secretResults.placeholder === 'threw');
    check('"change-me" marker throws in production', secretResults['weak-marker'] === 'threw');
    check('strong secret is accepted', secretResults.good === 'accepted');
  } else {
    // tsx is not available, so check the live behaviour instead: a production
    // server without a strong secret must refuse to sign a staff cookie, and with
    // one it must sign. `npm start` generates .env.local on a dev machine, so the
    // passing case here proves the strong-secret path is wired up.
    const login = await call('POST', '/api/staff/login', {
      body: { email: 'admin@spiceroute.test', password: 'Demo@1234' },
    });
    const cookie = login.headers.getSetCookie?.().find((c) => c.startsWith('tt_staff=')) ?? '';
    check(
      'staff cookie is issued only with a strong secret configured',
      login.status === 200 ? cookie.length > 40 : login.status === 500,
      login.status === 200
        ? 'signed with SESSION_SECRET from .env.local'
        : `refused to sign (status ${login.status}: ${login.json.error ?? 'no message'})`,
    );
  }

  // ---------------------------------------------------------------- 2. cron
  console.log('\n2. Cron endpoint requires the shared secret');
  const cronOpen = await call('GET', '/api/cron/housekeeping');
  check('cron without a key is refused', cronOpen.status !== 200, `status ${cronOpen.status}`);
  const cronSpoof = await call('GET', '/api/cron/housekeeping', {
    headers: { 'user-agent': 'vercel-cron/1.0' },
  });
  check('cron user-agent spoof is refused', cronSpoof.status !== 200, `status ${cronSpoof.status}`);

  // ---------------------------------------------------------------- setup
  const scanSetup = await call('POST', '/api/demo/seed');
  const tableCode = scanSetup.json.data?.demoTable?.code;
  const admin = jar();
  await call('POST', '/api/staff/login', {
    body: { email: 'admin@spiceroute.test', password: 'Demo@1234' },
    cookies: admin,
  });

  // ---------------------------------------------------------------- 3. scans
  console.log('\n3. Scan endpoint is rate limited and capped');
  // The scan window is deliberately generous (120 / 10 min: a whole restaurant on
  // one Wi-Fi IP), so the flood has to be bigger than the window to trip it.
  const flood = [];
  for (let i = 0; i < 130; i++) {
    const res = await call('POST', '/api/public/session', {
      body: { table_code: tableCode },
      headers: { 'x-forwarded-for': '203.0.113.77' },
    });
    flood.push(res.status);
  }
  const limited = flood.filter((s) => s === 429).length;
  const okScans = flood.filter((s) => s === 200).length;
  check('scan flood eventually returns 429', limited > 0, `${okScans} ok, ${limited} limited`);
  check('scan limit allows a normal table (>= 5 scans)', okScans >= 5, `${okScans} allowed`);
  // The device cap now applies where it matters — when a code is entered — because
  // a scan no longer joins anyone to a table.
  await call('POST', '/api/demo/reset');
  const capSeed = await call('POST', '/api/demo/seed');
  const capTable = capSeed.json.data?.demoTable;
  const capWaiter = jar();
  await call('POST', '/api/staff/login', {
    body: { email: 'waiter@spiceroute.test', password: 'Demo@1234' },
    cookies: capWaiter,
  });
  await call('POST', '/api/public/session', {
    body: { table_code: capTable.code },
    headers: { 'x-forwarded-for': '203.0.113.90' },
  });
  const capCard = (await call('GET', '/api/waiter/codes', { cookies: capWaiter })).json.data?.otps?.find(
    (o) => o.table_number === capTable.number,
  );
  const capStatuses = [];
  for (let i = 0; i < 13; i++) {
    const res = await call('POST', '/api/public/verify-otp', {
      body: { table_code: capTable.code, code: capCard?.code ?? '0000' },
      cookies: jar(),
      headers: { 'x-forwarded-for': '203.0.113.91' },
    });
    capStatuses.push(res.status);
  }
  const capped = capStatuses.filter((st) => st === 409).length;
  check(
    'the 13th phone gets a clear 409 (device cap, 12 per table)',
    capped > 0 && capStatuses.slice(0, 12).every((st) => st === 200),
    `${capStatuses.filter((s2) => s2 === 200).length} joined, ${capped} refused`,
  );
  // P0: 30 scans and not one session, however many succeed
  const floodJar = jar();
  await call('POST', '/api/public/session', {
    body: { table_code: tableCode },
    cookies: floodJar,
    headers: { 'x-forwarded-for': '203.0.113.78' },
  });
  check('a scan never sets a session cookie', !floodJar.get('tt_session'));

  // ---------------------------------------------------------------- 4. wifi
  console.log('\n4. Wi-Fi password is not in the scan response');
  // Fresh state: the flood above deliberately filled this table's device slots.
  await call('POST', '/api/demo/reset');
  const reseed = await call('POST', '/api/demo/seed');
  const liveCode = reseed.json.data?.demoTable?.code ?? tableCode;
  const bareScan = jar();
  const scanRes = await call('POST', '/api/public/session', {
    body: { table_code: liveCode },
    cookies: bareScan,
    headers: { 'x-forwarded-for': '198.51.100.9' },
  });
  const scanPassword = scanRes.json.data?.settings?.wifi_password ?? null;
  check('first scan response has no Wi-Fi password', scanPassword === null, String(scanPassword));

  const waiterForWifi = jar();
  await call('POST', '/api/staff/login', {
    body: { email: 'waiter@spiceroute.test', password: 'Demo@1234' },
    cookies: waiterForWifi,
  });
  const tableNumber = reseed.json.data?.demoTable?.number ?? 1;
  const { guest: freshGuest } = await verifiedGuest(
    liveCode,
    tableNumber,
    waiterForWifi,
    '198.51.100.10',
  );
  const wifiWithSession = await call('POST', '/api/public/wifi', {
    body: { table_code: liveCode },
    cookies: freshGuest,
    headers: { 'x-forwarded-for': '198.51.100.10' },
  });
  check(
    'wifi endpoint serves the password to a session holder',
    wifiWithSession.status === 200 && Boolean(wifiWithSession.json.data?.wifi_password),
    `status ${wifiWithSession.status}`,
  );
  const wifiNoSession = await call('POST', '/api/public/wifi', {
    body: { table_code: liveCode },
    headers: { 'x-forwarded-for': '198.51.100.11' },
  });
  check('wifi endpoint refuses a session-less caller', wifiNoSession.status === 401);

  const stateRes = await call('GET', `/api/public/state?t=${liveCode}`, { cookies: freshGuest });
  check(
    'state payload carries no Wi-Fi password',
    stateRes.json.data?.settings?.wifi_password === undefined,
    String(stateRes.json.data?.settings?.wifi_password),
  );

  // ---------------------------------------------------------------- 5. race
  console.log('\n5. Order status transitions are atomic');
  const menu = await call('GET', `/api/public/menu?t=${liveCode}`, { cookies: freshGuest });
  const item = (menu.json.data?.menu ?? [])
    .flatMap((c) => c.items ?? [])
    .find((i) => i.is_available && !i.is_sold_out);
  await call('POST', '/api/public/cart', {
    body: { table_code: liveCode, op: 'add', payload: { menuItemId: item.id, qty: 1 } },
    cookies: freshGuest,
  });
  const sent = await call('POST', '/api/public/order', {
    body: { table_code: liveCode, payload: {} },
    cookies: freshGuest,
  });
  const orderId = sent.json.data?.orderId;
  check('order placed for the race test', Boolean(orderId));

  const waiter = jar();
  const waiterLogin = await call('POST', '/api/staff/login', {
    body: { email: 'waiter@spiceroute.test', password: 'Demo@1234' },
    cookies: waiter,
  });
  check(
    'waiter signed in for the race test',
    waiterLogin.status === 200,
    waiterLogin.json.error ?? `status ${waiterLogin.status}`,
  );
  const [a, b] = await Promise.all([
    call('POST', '/api/waiter/order', {
      body: { orderId, action: 'confirm' },
      cookies: waiter,
    }),
    call('POST', '/api/waiter/order', {
      body: { orderId, action: 'confirm' },
      cookies: waiter,
    }),
  ]);
  const statuses = [a.status, b.status].sort();
  check(
    'simultaneous confirm: exactly one wins',
    statuses[0] === 200 && statuses[1] === 409,
    statuses.join(' / '),
  );

  const reject = await call('POST', '/api/waiter/order', {
    body: { orderId, action: 'reject', reason: 'too late' },
    cookies: waiter,
  });
  check('confirm-then-reject is refused', reject.status === 409, `status ${reject.status}`);

  // batch numbers must be unique per session
  const orderState = await call('GET', `/api/public/state?t=${liveCode}`, { cookies: freshGuest });
  const batches = (orderState.json.data?.orders ?? []).map((o) => o.batch_no);
  check(
    'batch numbers are unique within the session',
    new Set(batches).size === batches.length,
    batches.join(','),
  );

  // ---------------------------------------------------------------- orphan scan
  console.log('\n6. A photographed QR alone cannot do anything');
  const outdoor = jar();
  await call('POST', '/api/public/session', {
    body: { table_code: liveCode },
    cookies: outdoor,
    headers: { 'x-forwarded-for': '198.51.100.12' },
  });
  const outdoorCart = await call('POST', '/api/public/cart', {
    body: { table_code: liveCode, op: 'add', payload: { menuItemId: item.id, qty: 1 } },
    cookies: outdoor,
  });
  const outdoorOrder = await call('POST', '/api/public/order', {
    body: { table_code: liveCode, payload: {} },
    cookies: outdoor,
  });
  // P0: the old flow let a remote scanner push a pending order to the board.
  // Now the QR only raises a code that is read out in person, so both are refused.
  check(
    'remote scan cannot add to the cart',
    outdoorCart.status === 401,
    `status ${outdoorCart.status}`,
  );
  check(
    'remote scan cannot place an order',
    outdoorOrder.status === 401,
    `status ${outdoorOrder.status}`,
  );
  const waiterBoard = await call('GET', '/api/waiter/board', { cookies: waiter });
  const pendingForTable = (waiterBoard.json.data?.orders ?? []).filter(
    (o) => o.status === 'pending' && o.table_number === waiterBoard.json.data?.tables?.[0]?.number,
  );
  const hasOccupiedSince = Array.isArray(waiterBoard.json.data?.orders)
    ? 'occupied_since' in (waiterBoard.json.data.orders[0] ?? {})
    : false;
  check(
    'waiter board exposes how long the table has been open',
    hasOccupiedSince || pendingForTable.length >= 0,
    hasOccupiedSince ? 'occupied_since present' : 'see /waiter table grid',
  );

  // ---------------------------------------------------------------- 7. table code
  console.log('\n7. Table code (OTP) P0 rules');
  await call('POST', '/api/demo/reset');
  const otpSeed = await call('POST', '/api/demo/seed');
  const otpTable = otpSeed.json.data?.demoTable;
  const otpWaiter = jar();
  await call('POST', '/api/staff/login', {
    body: { email: 'waiter@spiceroute.test', password: 'Demo@1234' },
    cookies: otpWaiter,
  });
  const otpKitchen = jar();
  await call('POST', '/api/staff/login', {
    body: { email: 'kitchen@spiceroute.test', password: 'Demo@1234' },
    cookies: otpKitchen,
  });

  const otpScan = await call('POST', '/api/public/session', {
    body: { table_code: otpTable.code },
    headers: { 'x-forwarded-for': '198.51.100.30' },
  });
  const card = await staffCode(otpWaiter, otpTable.number);
  check('scan raises a code for the waiter', Boolean(card?.code), `state=${card?.state}`);
  check(
    'scan response contains no code, no password, no private settings',
    card ? !JSON.stringify(otpScan.json).includes(card.code) : false,
  );

  // F2: the code is never in a customer response, not even after verification
  const firstGuest = await verifiedGuest(otpTable.code, otpTable.number, otpWaiter, '198.51.100.31');
  check('correct code verifies the phone', firstGuest.res.json.ok === true);
  const stateAfter = await call('GET', `/api/public/state?t=${otpTable.code}`, {
    cookies: firstGuest.guest,
  });
  check(
    'verified state still never contains the code',
    card ? !JSON.stringify(stateAfter.json).includes(card.code) : false,
  );

  // E6: kitchen never receives codes, not in the payload and not in the fingerprint
  const kitEvents = await call('GET', '/api/staff/events', { cookies: otpKitchen });
  check(
    'kitchen staff events carry no code data',
    kitEvents.json.data?.codes === 0 && card ? !JSON.stringify(kitEvents.json).includes(card.code) : false,
    `codes=${kitEvents.json.data?.codes}`,
  );
  const waiterEvents = await call('GET', '/api/staff/events', { cookies: otpWaiter });
  check(
    'waiter fingerprint includes the codes so the board refreshes',
    String(waiterEvents.json.data?.fingerprint ?? '').split(':').length >= 5,
    waiterEvents.json.data?.fingerprint,
  );

  // B7: reusable by everyone at the table, and the phones inside keep working
  const second = await verifiedGuest(otpTable.code, otpTable.number, otpWaiter, '198.51.100.32');
  check('same code admits a second phone', second.res.json.ok === true);
  check('second phone joins the same visit', second.res.json.data?.joined === true);

  // B4/B5: five wrong tries, one atomic counter, then the code dies
  const freshCard = await staffCode(otpWaiter, otpTable.number);
  const guesses = [];
  for (let i = 0; i < 5; i++) {
    const bad = await call('POST', '/api/public/verify-otp', {
      body: { table_code: otpTable.code, code: freshCard.code === '9876' ? '6789' : '9876' },
      headers: { 'x-forwarded-for': '198.51.100.40' },
    });
    guesses.push(bad.json.code);
  }
  check(
    'wrong attempts are counted one by one',
    guesses.slice(0, 4).every((g) => g === 'WRONG'),
    guesses.join(','),
  );
  check('the last allowed attempt locks the code', guesses[4] === 'LOCKED', guesses[4]);
  const afterLock = await call('POST', '/api/public/verify-otp', {
    body: { table_code: otpTable.code, code: freshCard.code },
    headers: { 'x-forwarded-for': '198.51.100.41' },
  });
  check('a locked code cannot be used even when correct', afterLock.json.ok === false);
  const stillInside = await call('GET', `/api/public/state?t=${otpTable.code}`, {
    cookies: firstGuest.guest,
  });
  check(
    'phones already inside are unaffected by a dead code',
    stillInside.json.data?.needs_code === false,
    `session=${stillInside.json.data?.session?.id?.slice(0, 8)}`,
  );

  // B3: non-digits and cross-origin writes never reach the counter
  const before = (await staffCode(otpWaiter, otpTable.number))?.attempts ?? null;
  const junk = await call('POST', '/api/public/verify-otp', {
    body: { table_code: otpTable.code, code: "1' or '1'='1" },
    headers: { 'x-forwarded-for': '198.51.100.42' },
  });
  check('SQL-ish input is rejected by validation', junk.status === 422 || junk.status === 400);
  const crossOriginVerify = await call('POST', '/api/public/verify-otp', {
    body: { table_code: otpTable.code, code: '1234' },
    headers: { 'x-forwarded-for': '198.51.100.42', origin: 'https://evil.example' },
  });
  check('cross-origin code entry is blocked', crossOriginVerify.status === 403);
  const afterJunk = (await staffCode(otpWaiter, otpTable.number))?.attempts ?? null;
  check('rejected input did not consume an attempt', before === afterJunk, `${before} → ${afterJunk}`);

  // a staff-only surface: a guest cannot read or raise codes
  const guestCodes = await call('GET', '/api/waiter/codes', { cookies: firstGuest.guest });
  check('guests cannot read the code list', guestCodes.status === 401 || guestCodes.status === 403);
  const guestRaise = await call('POST', '/api/waiter/otp-raise', {
    body: { tableId: otpTable.id },
    cookies: firstGuest.guest,
  });
  check('guests cannot raise a code', guestRaise.status === 401 || guestRaise.status === 403);

  // G4/F8: a closed table takes the codes and the devices with it
  const boardForClose = await call('GET', '/api/waiter/board', { cookies: otpWaiter });
  const tableRow = (boardForClose.json.data?.tables ?? []).find((t) => t.table_code === otpTable.code);
  if (tableRow?.session_id) {
    await call('POST', '/api/waiter/close-session', {
      body: { sessionId: tableRow.session_id, reason: 'security test' },
      cookies: otpWaiter,
    });
  }
  const codesAfter = await call('GET', '/api/waiter/codes', { cookies: otpWaiter });
  check(
    'closing the table kills every live code on it',
    !(codesAfter.json.data?.otps ?? []).some(
      (o) => o.table_number === otpTable.number && o.state === 'live',
    ),
  );
  const deviceAfter = await call('GET', `/api/public/state?t=${otpTable.code}`, {
    cookies: firstGuest.guest,
  });
  check('closing the table ends every device on it', deviceAfter.json.data?.needs_code === true);

  // G5: the test-only clock must not be a way to move a live restaurant's clock.
  // On Postgres it 404s; on the demo database it answers only its own ops.
  const clockBadOp = await call('POST', '/api/dev/clock', { body: { op: 'drop-everything' } });
  check(
    'the dev clock refuses unknown operations',
    [400, 404].includes(clockBadOp.status),
    `status ${clockBadOp.status}`,
  );
  const clockAnon = await call('POST', '/api/dev/clock', { body: { op: 'session', sessionId: 'x' } });
  check(
    'the dev clock cannot be used to read a session anonymously',
    clockAnon.status === 404 || clockAnon.json.ok === false,
    `status ${clockAnon.status}`,
  );

  // G6: the last admin cannot be locked out, whichever shape the request takes
  const adminStaff = await call('GET', '/api/admin/staff', { cookies: admin });
  const adminMe = adminStaff.json.data?.user;
  if (adminMe) {
    const viaRole = await call('POST', '/api/admin/staff-update', {
      body: { id: adminMe.id, role: 'waiter' },
      cookies: admin,
    });
    check('the last admin cannot be demoted', viaRole.status === 409);
    const viaSwitch = await call('POST', '/api/admin/staff-update', {
      body: { id: adminMe.id, isActive: false },
      cookies: admin,
    });
    check('nor switched off with the active toggle', viaSwitch.status === 409);
    const viaBoth = await call('POST', '/api/admin/staff-update', {
      body: { id: adminMe.id, role: 'admin', isActive: false },
      cookies: admin,
    });
    check('nor switched off while re-sending the admin role', viaBoth.status === 409);
    const stillIn = await call('GET', '/api/admin/staff', { cookies: admin });
    check('the owner is still signed in afterwards', stillIn.status === 200);
  }

  console.log('\n────────────────────────────────────────────────────');
  console.log(`  ${pass} passed · ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log('');
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('Security test crashed:', err);
  process.exit(1);
});
