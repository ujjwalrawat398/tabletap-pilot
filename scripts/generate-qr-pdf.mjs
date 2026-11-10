#!/usr/bin/env node
/**
 * Writes a print-ready A4 PDF with one QR card per table (deliverable #4).
 *
 *   NEXT_PUBLIC_APP_URL=https://your-domain.com npm run qr:pdf
 *   DATABASE_URL=postgres://…            node scripts/generate-qr-pdf.mjs   (Postgres/Supabase)
 *   PGLITE_DIR=.pglite                   node scripts/generate-qr-pdf.mjs   (local file DB)
 *
 * Flags: --out public/table-qr-codes.pdf  --url https://x.y
 * Without a database it renders a preview sheet with placeholder codes so the
 * layout can be checked before the client's tables exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildTableQrPdf } from '../src/lib/qr-pdf.mjs';

const args = process.argv.slice(2);
const argVal = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = argVal('out', 'public/table-qr-codes.pdf');
const APP_URL = argVal('url', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

async function load() {
  const DATABASE_URL = process.env.DATABASE_URL;

  if (DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    });
    const { rows: restaurants } = await pool.query(`select id, name from restaurants order by created_at limit 1`);
    if (!restaurants.length) throw new Error('No restaurant found in the database.');
    const { rows: tables } = await pool.query(
      `select number, label, table_code from tables where restaurant_id = $1 and is_active order by number`,
      [restaurants[0].id],
    );
    await pool.end();
    return { restaurantName: restaurants[0].name, tables };
  }

  const dir = process.env.PGLITE_DIR;
  if (dir && fs.existsSync(dir)) {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(dir);
    const r = await db.query(`select id, name from restaurants order by created_at limit 1`);
    if (!r.rows.length) throw new Error('No restaurant in the local database.');
    const t = await db.query(
      `select number, label, table_code from tables where restaurant_id = $1 and is_active order by number`,
      [r.rows[0].id],
    );
    await db.close();
    return { restaurantName: r.rows[0].name, tables: t.rows };
  }

  console.warn(
    '! No DATABASE_URL / PGLITE_DIR — writing a preview sheet with placeholder codes.\n' +
      '  Use DATABASE_URL (Supabase/postgres) or PGLITE_DIR=.pglite for real table codes.\n',
  );
  return {
    restaurantName: 'Spice Route Kitchen (preview)',
    tables: Array.from({ length: 6 }, (_, i) => ({
      number: i + 1,
      label: null,
      table_code: `preview${String(i + 1).padStart(3, '0')}code`,
    })),
  };
}

const { restaurantName, tables } = await load();
if (!tables.length) {
  console.error('No tables found. Create tables in Admin → Tables first.');
  process.exit(1);
}

const pdf = await buildTableQrPdf({ restaurantName, appUrl: APP_URL, tables });
const outPath = path.resolve(OUT);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, pdf);

console.log(`\n✓ ${tables.length} table cards → ${outPath} (${Math.round(pdf.length / 1024)} KB)`);
console.log(`  base URL: ${APP_URL}`);
console.log('  Print at 100% scale on A4, cut along the card borders.\n');
