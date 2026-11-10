#!/usr/bin/env node
/**
 * Staff password changes.
 *
 *   node scripts/password-flow-test.mjs [http://127.0.0.1:3000]
 *
 * Needs the embedded demo database (it calls /api/demo/reset and /api/demo/seed to
 * start every phase from the three demo accounts and to put their passwords back).
 *
 *   waiter / kitchen -> must prove the current password, then an admin approves
 *   admin            -> changes it straight away, current password required
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const DEMO = 'Demo@1234';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

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
  };
}
async function call(method, path, { body, cookies } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', origin: BASE, ...(cookies ? { cookie: cookies.header() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  cookies?.absorb(r);
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: r.status, json, text };
}
async function login(email, password) {
  const c = jar();
  const r = await call('POST', '/api/staff/login', { body: { email, password }, cookies: c });
  return { status: r.status, cookies: c };
}
/** Fresh demo state, demo passwords restored (reset clears rate limits and open requests). */
async function fresh() {
  const reset = await call('POST', '/api/demo/reset');
  if (reset.status !== 200) throw new Error(`demo/reset unavailable (${reset.status}) — this suite needs the embedded demo database`);
  await call('POST', '/api/demo/seed');
}
const WAITER = 'waiter@spiceroute.test';
const ADMIN = 'admin@spiceroute.test';

async function main() {
  console.log(`\nStaff password flow → ${BASE}\n`);

  // ── A: request, wrong attempts, reject ─────────────────────────────────
  console.log('A. waiter asks, admin rejects');
  await fresh();
  const admin = (await login(ADMIN, DEMO)).cookies;
  const waiter = (await login(WAITER, DEMO)).cookies;
  const NEW1 = 'Fresh#Pass1';

  check('signed-out request is refused', (await call('POST', '/api/staff/password', { body: { currentPassword: DEMO, newPassword: NEW1 } })).status === 401);
  const wrong = await call('POST', '/api/staff/password', { cookies: waiter, body: { currentPassword: 'NotMyPass9', newPassword: NEW1 } });
  check('wrong current password is refused', wrong.status === 400 && /current password/i.test(wrong.json.error ?? ''), wrong.json.error);
  const weak = await call('POST', '/api/staff/password', { cookies: waiter, body: { currentPassword: DEMO, newPassword: 'onlyletters' } });
  check('a weak new password is refused', weak.status === 400 || weak.status === 422, weak.json.error);
  const same = await call('POST', '/api/staff/password', { cookies: waiter, body: { currentPassword: DEMO, newPassword: DEMO } });
  check('the same password again is refused', same.status === 400, same.json.error);

  const filed = await call('POST', '/api/staff/password', { cookies: waiter, body: { currentPassword: DEMO, newPassword: NEW1 } });
  check('a valid request is filed, not applied', filed.status === 200 && filed.json.data?.pending === true && filed.json.data?.applied === false);
  check('old password still works while waiting', (await login(WAITER, DEMO)).status === 200);
  check('new password does NOT work before approval', (await login(WAITER, NEW1)).status === 401);
  const mine = await call('GET', '/api/staff/password', { cookies: waiter });
  check('waiter sees the request as pending', mine.json.data?.request?.status === 'pending');

  const sneaky = await call('POST', '/api/admin/password-request-approve', { cookies: waiter, body: { id: filed.json.data.request.id } });
  check('a waiter cannot approve their own request', sneaky.status === 403, String(sneaky.status));

  const list = await call('GET', '/api/admin/password-requests', { cookies: admin });
  const open = list.json.data?.requests ?? [];
  check('admin sees exactly that request', open.length === 1 && open[0].email === WAITER);
  check('the requested password is never sent to the admin', !list.text.includes(NEW1) && !/new_password_enc/.test(list.text));

  const rej = await call('POST', '/api/admin/password-request-reject', { cookies: admin, body: { id: open[0].id, note: 'Ask me first' } });
  check('admin rejects it', rej.status === 200);
  check('rejected password does not work', (await login(WAITER, NEW1)).status === 401);
  const after = await call('GET', '/api/staff/password', { cookies: waiter });
  check('waiter is told why', after.json.data?.request?.status === 'rejected' && after.json.data.request.decision_note === 'Ask me first');

  // ── B: replace, approve, double approve ────────────────────────────────
  console.log('\nB. newer request replaces the old one, approval applies it once');
  await fresh();
  const admin2 = (await login(ADMIN, DEMO)).cookies;
  const waiter2 = (await login(WAITER, DEMO)).cookies;
  const PW_A = 'First#Pass1';
  const PW_B = 'Second#Pass2';
  await call('POST', '/api/staff/password', { cookies: waiter2, body: { currentPassword: DEMO, newPassword: PW_A } });
  await call('POST', '/api/staff/password', { cookies: waiter2, body: { currentPassword: DEMO, newPassword: PW_B } });
  const open2 = (await call('GET', '/api/admin/password-requests', { cookies: admin2 })).json.data.requests;
  check('only one open request per person', open2.length === 1);
  const approved = await call('POST', '/api/admin/password-request-approve', { cookies: admin2, body: { id: open2[0].id } });
  check('admin approves', approved.status === 200 && approved.json.data?.approved === true);
  const again = await call('POST', '/api/admin/password-request-approve', { cookies: admin2, body: { id: open2[0].id } });
  check('approving twice is refused', again.status === 409, String(again.status));
  check('the newest password works', (await login(WAITER, PW_B)).status === 200);
  check('the replaced password does not', (await login(WAITER, PW_A)).status === 401);
  check('the old password no longer works', (await login(WAITER, DEMO)).status === 401);
  const audit = await call('GET', '/api/admin/audit', { cookies: admin2 });
  check('approval is in the audit log', /staff\.password\.approve/.test(audit.text) && /staff\.password\.request/.test(audit.text));
  check('no password in the audit log', !audit.text.includes(PW_A) && !audit.text.includes(PW_B));

  // ── C: withdraw ────────────────────────────────────────────────────────
  console.log('\nC. withdrawing a request');
  await fresh();
  const admin3 = (await login(ADMIN, DEMO)).cookies;
  const waiter3 = (await login(WAITER, DEMO)).cookies;
  const filed3 = await call('POST', '/api/staff/password', { cookies: waiter3, body: { currentPassword: DEMO, newPassword: 'Later#Pass3' } });
  const del = await call('DELETE', '/api/staff/password', { cookies: waiter3 });
  check('waiter withdraws it', del.status === 200 && del.json.data?.cancelled === true);
  check('admin no longer sees it', ((await call('GET', '/api/admin/password-requests', { cookies: admin3 })).json.data.requests ?? []).length === 0);
  const late = await call('POST', '/api/admin/password-request-approve', { cookies: admin3, body: { id: filed3.json.data.request.id } });
  check('a withdrawn request cannot be approved', late.status === 409, String(late.status));

  // ── D: admin's own password, and admin resetting someone else ──────────
  console.log('\nD. admin changes own password (current required)');
  await fresh();
  const admin4 = (await login(ADMIN, DEMO)).cookies;
  const staff = (await call('GET', '/api/admin/staff', { cookies: admin4 })).json.data.staff;
  const me = staff.find((s) => s.email === ADMIN);
  const waiterRow = staff.find((s) => s.email === WAITER);
  const viaReset = await call('POST', '/api/admin/staff-update', { cookies: admin4, body: { id: me.id, password: 'Sneaky#Pass1' } });
  check('own password cannot be set through the reset shortcut', viaReset.status === 400, viaReset.json.error);
  check('...and nothing changed', (await login(ADMIN, 'Sneaky#Pass1')).status === 401);
  const badCur = await call('POST', '/api/staff/password', { cookies: admin4, body: { currentPassword: 'Nope#Nope9', newPassword: 'Owner#Pass4' } });
  check('wrong current password is refused for the admin too', badCur.status === 400);
  const ok = await call('POST', '/api/staff/password', { cookies: admin4, body: { currentPassword: DEMO, newPassword: 'Owner#Pass4' } });
  check('admin change is applied at once', ok.status === 200 && ok.json.data?.applied === true);
  check('new admin password works', (await login(ADMIN, 'Owner#Pass4')).status === 200);
  check('old admin password does not', (await login(ADMIN, DEMO)).status === 401);

  const reset = await call('POST', '/api/admin/staff-update', { cookies: admin4, body: { id: waiterRow.id, password: 'Chosen#By1Admin' } });
  check('admin can still reset a waiter directly', reset.status === 200 && (await login(WAITER, 'Chosen#By1Admin')).status === 200);
}

try {
  await main();
} catch (err) {
  fail++;
  console.log(`  ✗ ${err instanceof Error ? err.message : err}`);
} finally {
  try {
    await fresh(); // leave the demo accounts on the demo password for the other suites
  } catch {}
}

console.log(`\n${'─'.repeat(52)}\n  ${pass} passed · ${fail} failed\n`);
process.exit(fail ? 1 : 0);
