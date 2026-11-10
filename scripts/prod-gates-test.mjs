#!/usr/bin/env node
/**
 * Production fail-closed test. Starts `next start` (needs `npm run build` first)
 * with different environments and checks that:
 *   - production refuses to boot without DATABASE_URL (unless DEMO_MODE=on),
 *   - the demo / test-only routes stay closed on a real Postgres, whatever DEMO_MODE says,
 *   - they open only for an explicit local demo (no DATABASE_URL + DEMO_MODE=on).
 *
 *   npm run build && npm run test:prod
 *
 * No database is needed: the "real Postgres" cases point DATABASE_URL at a closed
 * port. The gates answer before any query is made.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.next/BUILD_ID')) {
  console.error('Run `npm run build` first.');
  process.exit(1);
}

const PORT = 3191;
const B = `http://localhost:${PORT}`;
const secret = 'x'.repeat(48);
const FAKE_PG = 'postgresql://nobody:nothing@127.0.0.1:9/none'; // nothing listens on port 9
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

async function req(method, path, body) {
  const r = await fetch(B + path, {
    method,
    headers: { 'content-type': 'application/json', origin: B },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  let json = null;
  try {
    json = await r.json();
  } catch {}
  return { status: r.status, json };
}
const post = async (p, b) => (await req('POST', p, b)).status;
const get = async (p) => (await req('GET', p)).status;

async function portInUse() {
  try {
    await get('/api/health');
    return true;
  } catch {
    return false;
  }
}

function start(env) {
  let output = '';
  const child = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    env: { ...process.env, NODE_ENV: 'production', SESSION_SECRET: secret, DATABASE_URL: '', DEMO_MODE: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group, so the whole tree can be stopped
  });
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
  const stop = async () => {
    try {
      process.kill(-child.pid, 'SIGKILL'); // npx + next-server, not just the wrapper
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  };
  return { child, exited, stop, output: () => output };
}

async function withServer(label, env, fn) {
  console.log(`\n${label}`);
  if (await portInUse()) {
    console.error(`  port ${PORT} is already in use by another server — stop it and rerun.`);
    process.exit(1);
  }
  const srv = start(env);
  try {
    let up = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        if ((await get('/api/health')) > 0) {
          up = true;
          break;
        }
      } catch {}
    }
    if (!up) {
      check('server started', false, srv.output().slice(-300));
      return;
    }
    await fn();
  } finally {
    await srv.stop();
  }
}

const closed = (s) => s === 403 || s === 404 || s === 405;

/** Every demo / test-only door, shut. */
async function expectAllClosed() {
  check('POST /api/setup is closed', closed(await post('/api/setup')));
  check('GET /api/setup is closed', closed(await get('/api/setup')));
  check('POST /api/demo/seed is closed', closed(await post('/api/demo/seed')));
  check('POST /api/demo/reset is closed', closed(await post('/api/demo/reset')));
  check('POST /api/dev/clock is closed', closed(await post('/api/dev/clock', { op: 'session', sessionId: 'x' })));
  check('/setup page is a 404', (await get('/setup')) === 404);
  check('GET /api/staff/login no longer lists staff counts', closed(await get('/api/staff/login')));

  const seedInfo = await req('GET', '/api/demo/seed');
  const d = seedInfo.json?.data ?? {};
  check(
    'GET /api/demo/seed tells a stranger nothing',
    seedInfo.status === 200 && d.demoAllowed === false && d.mode === 'hidden' && d.staffCount === 0 && d.demoTable === null,
    JSON.stringify(d),
  );
  const login = await post('/api/staff/login', { email: 'admin@spiceroute.test', password: 'Demo@1234' });
  check('no demo admin login exists', login === 401 || login === 400 || login === 500, String(login));
}

// 1 ── production, no DATABASE_URL, no explicit demo: the server must not come up at all
console.log('\nProduction, no DATABASE_URL, DEMO_MODE unset — must refuse to start');
{
  if (await portInUse()) {
    console.error(`  port ${PORT} is already in use by another server — stop it and rerun.`);
    process.exit(1);
  }
  const srv = start({});
  const code = await Promise.race([srv.exited, new Promise((r) => setTimeout(() => r('still-running'), 25000))]);
  let reachable = false;
  try {
    reachable = (await get('/api/health')) > 0;
  } catch {}
  await srv.stop();
  check('the process exits instead of serving', code !== 'still-running' && code !== 0, `exit: ${code}`);
  check('nothing answers on the port', !reachable);
  // informational: what the operator sees
  console.log(`    ↳ ${/DATABASE_URL is required/.test(srv.output()) ? 'message names DATABASE_URL' : 'message not captured (check the server log)'}`);
}

// 2 ── real Postgres (unreachable here), DEMO_MODE unset
await withServer('Production, real Postgres, DEMO_MODE unset', { DATABASE_URL: FAKE_PG }, expectAllClosed);

// 3 ── real Postgres, DEMO_MODE=off
await withServer('Production, real Postgres, DEMO_MODE=off', { DATABASE_URL: FAKE_PG, DEMO_MODE: 'off' }, expectAllClosed);

// 4 ── real Postgres, DEMO_MODE=on: still closed, a live database never gets demo logins or a wipe
await withServer(
  'Production, real Postgres, DEMO_MODE=on (a live restaurant must still be safe)',
  { DATABASE_URL: FAKE_PG, DEMO_MODE: 'on' },
  expectAllClosed,
);

// 5 ── explicit local demo: embedded DB + DEMO_MODE=on
await withServer('Production, embedded DB, DEMO_MODE=on (explicit local demo)', { DEMO_MODE: 'on' }, async () => {
  check('POST /api/setup works only because of the explicit opt-in', (await post('/api/setup')) === 200);
  const info = await req('GET', '/api/demo/seed');
  check('GET /api/demo/seed reports the demo as available', info.json?.data?.demoAllowed === true);
});

console.log(`\n${'─'.repeat(52)}\n  ${pass} passed · ${fail} failed\n`);
process.exit(fail ? 1 : 0);
