#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql to a real Postgres (DATABASE_URL),
 * in filename order, each in its own transaction. Applied migrations are
 * recorded in `tabletap_migrations` and skipped on later runs.
 *
 * The app itself never migrates a real Postgres (only the embedded PGlite
 * demo database bootstraps itself), so a fresh Supabase/Postgres needs this
 * once before the first deploy:
 *
 *   DATABASE_URL=postgresql://... npm run db:migrate
 *
 * For a database whose migrations were already applied by hand (e.g. pasted
 * into the Supabase SQL editor), record them without re-running:
 *
 *   DATABASE_URL=postgresql://... npm run db:migrate -- --baseline
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required: set it to your Supabase/Postgres connection string.');
  process.exit(1);
}
const baseline = process.argv.includes('--baseline');

const dir = path.join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? undefined : { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(
    `create table if not exists tabletap_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`,
  );
  const { rows } = await client.query('select name from tabletap_migrations');
  const applied = new Set(rows.map((r) => r.name));

  let ran = 0;
  for (const name of files) {
    if (applied.has(name)) {
      console.log(`  skip  ${name} (already applied)`);
      continue;
    }
    if (baseline) {
      await client.query('insert into tabletap_migrations (name) values ($1)', [name]);
      console.log(`  base  ${name} (recorded, not run)`);
      ran++;
      continue;
    }
    const sql = readFileSync(path.join(dir, name), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into tabletap_migrations (name) values ($1)', [name]);
      await client.query('commit');
      console.log(`  apply ${name}`);
      ran++;
    } catch (err) {
      await client.query('rollback');
      console.error(`Migration failed: ${name}`);
      throw err;
    }
  }
  console.log(ran ? `Done: ${ran} migration(s) ${baseline ? 'recorded' : 'applied'}.` : 'Already up to date.');
} finally {
  await client.end();
}
