/**
 * Text sanitising for user-supplied content (feedback, order notes, names).
 * React already escapes on render; this is defence in depth for anything that
 * might be stored, exported to CSV, or echoed back through JSON.
 */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeText(input: string, maxLength = 500): string {
  return input
    .replace(CONTROL, '')
    .replace(/<[^>]*>/g, '') // strip tags
    .replace(/[<>]/g, '') // strip stray angle brackets
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function sanitizeMultiline(input: string, maxLength = 1000): string {
  return input
    .replace(CONTROL, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

/** Escapes a value for CSV export to prevent formula injection. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}
