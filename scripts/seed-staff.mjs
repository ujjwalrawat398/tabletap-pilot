#!/usr/bin/env node
/**
 * Creates the three demo staff logins for the seeded restaurant
 * ("Spice Route Kitchen"):
 *
 *   admin@spiceroute.test    / Demo@1234   (admin)
 *   waiter@spiceroute.test   / Demo@1234   (waiter)
 *   kitchen@spiceroute.test  / Demo@1234   (kitchen)
 *
 * Supabase mode  (DATABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *   -> creates real Supabase Auth users (bcrypt, server-side) + staff_profiles
 * Local  mode  (DATABASE_URL only, or nothing for PGlite)
 *   -> writes scrypt hashes into staff_credentials
 *
 * Usage:
 *   node scripts/seed-staff.mjs
 *   node scripts/seed-staff.mjs --password 'MyStrongPass123' --email owner@cafe.com --role admin
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(SUPABASE_URL && SERVICE_KEY);

const DEMO_PASSWORD = arg('password', process.env.DEMO_PASSWORD ?? 'Demo@1234');
const ROLE_ARG = arg('role');
const EMAIL_ARG = arg('email');

const ACCOUNTS = ROLE_ARG && EMAIL_ARG
  ? [{ email: EMAIL_ARG, role: ROLE_ARG, name: 'Owner' }]
  : [
      { email: 'admin@spiceroute.test', role: 'admin', name: 'Ananya (Owner)' },
      { email: 'waiter@spiceroute.test', role: 'waiter', name: 'Ravi (Waiter)' },
      { email: 'kitchen@spiceroute.test', role: 'kitchen', name: 'Chef Imran' },
    ];

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}


/**
 * Upsert a staff profile by email. The unique index is on
 * (restaurant_id, lower(email)) so ON CONFLICT cannot be used with the plain
 * email column — do the lookup explicitly instead.
 */
async function upsertProfile(run, restaurantId, account) {
  const existing = await run(
    `select id from staff_profiles where restaurant_id = $1 and lower(email) = lower($2)`,
    [restaurantId, account.email],
  );
  if (existing.rows.length) {
    await run(`update staff_profiles set role = $2, is_active = true where id = $1`, [
      existing.rows[0].id,
      account.role,
    ]);
    return existing.rows[0].id;
  }
  const created = await run(
    `insert into staff_profiles (restaurant_id, user_id, email, full_name, role)
     values ($1,$2,$3,$4,$5) returning id`,
    [restaurantId, crypto.randomUUID(), account.email, account.name, account.role],
  );
  return created.rows[0].id;
}

async function main() {
  console.log(`\nTableTap · seeding staff accounts (${useSupabase ? 'Supabase' : 'local'})\n`);

  // ---------------------------------------------------------------- Supabase
  if (useSupabase) {
    const { default: pg } = await import('pg');
    if (!DATABASE_URL) {
      console.error('DATABASE_URL is required in Supabase mode (use the pooler connection string).');
      process.exit(1);
    }
    const pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { rows: restaurants } = await pool.query(
      `select id, name from restaurants order by created_at limit 1`,
    );
    if (!restaurants.length) {
      console.error('No restaurant found. Run the migrations + seed first.');
      process.exit(1);
    }
    const restaurant = restaurants[0];

    for (const account of ACCOUNTS) {
      let userId = null;
      const { data: created, error } = await admin.auth.admin.createUser({
        email: account.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: account.name },
      });
      if (error) {
        if (/already/i.test(error.message)) {
          const { data: list } = await admin.auth.admin.listUsers();
          userId = list?.users.find((u) => u.email?.toLowerCase() === account.email.toLowerCase())?.id;
        } else {
          console.error(`  ✗ ${account.email}: ${error.message}`);
          continue;
        }
      } else {
        userId = created.user.id;
      }

      await upsertProfile(
        (sql, params) => pool.query(sql, params),
        restaurant.id,
        { ...account, userId },
      );
      console.log(`  ✓ ${account.role.padEnd(8)} ${account.email}`);
    }
    await pool.end();
    console.log(`\nDone. Sign in at /staff/login with any of the emails above.\n`);
    return;
  }

  // ---------------------------------------------------------------- local pg
  if (DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    });
    const { rows: restaurants } = await pool.query(
      `select id from restaurants order by created_at limit 1`,
    );
    if (!restaurants.length) {
      console.error('No restaurant found. Run supabase/migrations then supabase/seed.');
      process.exit(1);
    }
    for (const account of ACCOUNTS) {
      const hash = await hashPassword(DEMO_PASSWORD);
      const profileId = await upsertProfile(
        (sql, params) => pool.query(sql, params),
        restaurants[0].id,
        account,
      );
      await pool.query(
        `insert into staff_credentials (user_id, password_hash) values ($1,$2)
         on conflict (user_id) do update set password_hash = excluded.password_hash`,
        [profileId, hash],
      );
      console.log(`  ✓ ${account.role.padEnd(8)} ${account.email}`);
    }
    await pool.end();
    console.log(`\nDone. Sign in at /staff/login (password: ${DEMO_PASSWORD})\n`);
    return;
  }

  // ---------------------------------------------------------------- PGlite
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR;
  if (!dir) {
    console.log(
      `Embedded PGlite runs in memory inside the dev server, so staff accounts cannot be
written from here. Two options:

  a) Start the app once, then open  /setup  and press "Seed staff logins"
     (the running process owns the in-memory database).

  b) Persist the local database to disk first:
       export PGLITE_DIR=.pglite
       npm run dev
     then run this script and restart the dev server.

  Demo accounts: admin@spiceroute.test / waiter@spiceroute.test / kitchen@spiceroute.test
  Password:      ${DEMO_PASSWORD}
`,
    );
    return;
  }

  const db = new PGlite(dir);
  const { rows } = await db.query(`select id from restaurants order by created_at limit 1`);
  if (!rows.length) {
    console.error('No restaurant in the local database. Start the app once to run migrations + seed.');
    process.exit(1);
  }
  for (const account of ACCOUNTS) {
    const hash = await hashPassword(DEMO_PASSWORD);
    const profileId = await upsertProfile(
      (sql, params) => db.query(sql, params),
      rows[0].id,
      account,
    );
    await db.query(
      `insert into staff_credentials (user_id, password_hash) values ($1,$2)
       on conflict (user_id) do update set password_hash = excluded.password_hash`,
      [profileId, hash],
    );
    console.log(`  ✓ ${account.role.padEnd(8)} ${account.email}`);
  }
  await db.close();
  console.log(`\nDone. Sign in at /staff/login (password: ${DEMO_PASSWORD})\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
