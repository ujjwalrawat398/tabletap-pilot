import 'server-only';
import { assertProductionConfig, env } from '@/lib/env';
import type { Pool as PgPool, PoolClient } from 'pg';
import type { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * One tiny SQL facade used by every repository function.
 *
 *  mode = 'pg'     -> node-postgres (Supabase pooler / any Postgres).
 *                     The connection runs as service_role (bypasses RLS) —
 *                     every repository function must therefore enforce the
 *                     role + restaurant scope itself, which it does.
 *  mode = 'pglite' -> embedded WASM Postgres for local dev, seeded from
 *                     supabase/migrations + supabase/seed on first boot.
 *
 * Only parameterised queries are used anywhere in this codebase (spec §14).
 */
export type Queryable = {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
};

export const dbMode: 'pg' | 'pglite' = env.DATABASE_URL ? 'pg' : 'pglite';

declare global {
  // eslint-disable-next-line no-var
  var __tabletap_pg: PgPool | undefined;
  // eslint-disable-next-line no-var
  var __tabletap_pglite: PGlite | undefined;
  // eslint-disable-next-line no-var
  var __tabletap_boot: Promise<void> | undefined;
}

/**
 * `next build` output is not tracked by the dev-server file watcher, which can
 * leave a stale in-memory database after a migration is added during a dev
 * session. Bump this file after changing supabase/migrations to force a rebuild
 * (production is unaffected — migrations run once, outside the app).
 */
const DB_MIGRATIONS_VERSION = 9;

/** Does this database already carry the newest schema (migrations 0006 to 0009)? */
async function hasLatestSchema(lite: PGlite) {
  const { rows } = await lite.query<{ present: boolean }>(
    `select (exists (select 1 from information_schema.tables
                      where table_schema='public' and table_name='table_otps')
         and exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name='table_otps'
                        and column_name='verified_at')
         and exists (select 1 from information_schema.tables
                      where table_schema='public' and table_name='staff_password_requests')
         and exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name='game_players'
                        and column_name='left_at')
         and exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name='game_rounds'
                        and column_name='cancel_reason')) as present`,
  );
  return Boolean(rows[0]?.present);
}

function loadSqlFiles(dir: string): { name: string; sql: string }[] {
  // dummy read keeps the dev watcher honest about this module's dependency
  if (DB_MIGRATIONS_VERSION < 0) fs.readFileSync(path.join(process.cwd(), dir));
  const absolute = path.join(process.cwd(), dir);
  if (!fs.existsSync(absolute)) return [];
  return fs
    .readdirSync(absolute)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(absolute, name), 'utf8') }));
}

async function bootstrapPglite(lite: PGlite) {
  const { rows } = await lite.query<{ exists: boolean }>(
    "select exists(select 1 from information_schema.tables where table_schema='public' and table_name='restaurants') as exists",
  );
  // A persisted PGLITE_DIR may predate the newest migration: apply it instead of
  // returning early, or every query touching the new columns fails at runtime.
  if (rows[0]?.exists && (await hasLatestSchema(lite))) return;

  console.log('[db] bootstrapping embedded Postgres (PGlite)…');
  for (const m of loadSqlFiles('supabase/migrations')) {
    try {
      await lite.exec(m.sql);
    } catch (err) {
      console.error(`[db] migration failed: ${m.name}`, err);
      throw err;
    }
  }
  for (const s of loadSqlFiles('supabase/seed')) {
    try {
      await lite.exec(s.sql);
    } catch (err) {
      console.error(`[db] seed failed: ${s.name}`, err);
      throw err;
    }
  }
  console.log('[db] local database ready');
}

async function getPglite(): Promise<PGlite> {
  if (!global.__tabletap_pglite) {
    assertProductionConfig(); // throws in production unless DEMO_MODE=on
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[tabletap] WARNING: running on the embedded database in production. Data lives in this ' +
          'process only. Set DATABASE_URL (Supabase/Postgres) before serving a real restaurant.',
      );
    }
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR;
    global.__tabletap_pglite = dir ? new PGlite(dir) : new PGlite();
  }
  if (!global.__tabletap_boot) global.__tabletap_boot = bootstrapPglite(global.__tabletap_pglite);
  await global.__tabletap_boot;
  return global.__tabletap_pglite;
}

async function getPool(): Promise<PgPool> {
  if (!global.__tabletap_pg) {
    const { Pool } = await import('pg');
    global.__tabletap_pg = new Pool({
      connectionString: env.DATABASE_URL,
      max: 8,
      ssl: /localhost|127\.0\.0\.1/.test(env.DATABASE_URL ?? '')
        ? undefined
        : { rejectUnauthorized: false },
    });
  }
  return global.__tabletap_pg;
}

export const db: Queryable = {
  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (dbMode === 'pg') {
      const pool = await getPool();
      const res = await pool.query(sql, params as any[]);
      return res.rows as T[];
    }
    const lite = await getPglite();
    const res = await lite.query(sql, params as any[]);
    return res.rows as T[];
  },

  async one<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await db.query<T>(sql, params);
    return rows[0] ?? null;
  },
};

/** Run several statements atomically on one connection. */
export async function transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  if (dbMode === 'pg') {
    const pool = await getPool();
    const client: PoolClient = await pool.connect();
    try {
      await client.query('begin');
      const out = await fn({
        query: async <T = any>(sql: string, params: unknown[] = []) =>
          (await client.query(sql, params as any[])).rows as T[],
        one: async <T = any>(sql: string, params: unknown[] = []) =>
          ((await client.query(sql, params as any[])).rows[0] as T) ?? null,
      });
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  const lite = await getPglite();
  await lite.exec('begin');
  try {
    const out = await fn({
      query: async <T = any>(sql: string, params: unknown[] = []) =>
        (await lite.query(sql, params as any[])).rows as T[],
      one: async <T = any>(sql: string, params: unknown[] = []) =>
        ((await lite.query(sql, params as any[])).rows[0] as T) ?? null,
    });
    await lite.exec('commit');
    return out;
  } catch (err) {
    await lite.exec('rollback');
    throw err;
  }
}

/** Health probe used by /api/health and the setup page. */
export async function dbHealth() {
  try {
    const row = await db.one<{ now: string }>('select now()::text as now');
    return { ok: true as const, mode: dbMode, now: row?.now };
  } catch (err) {
    return { ok: false as const, mode: dbMode, error: String(err) };
  }
}
