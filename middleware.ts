import { NextResponse, type NextRequest } from 'next/server';

/**
 * Guest route guard for /t/{code}.
 *
 * A scan no longer creates a session — the guest must type the waiter's table
 * code first (spec §3). The middleware therefore only routes:
 *
 *   /t/{code}                always renders (code screen or table home; the page
 *                            decides from the cookie + DB)
 *   /t/{code}/{sub-page}     without a live session → back to /t/{code}, where the
 *                            code screen explains what to do
 *
 * It never writes cookies and never calls the API, so it cannot grant access.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const match = pathname.match(/^\/t\/([A-Za-z0-9_-]{6,})(\/.*)?$/);
  if (!match) return NextResponse.next();

  const tableCode = match[1];
  const rest = match[2] ?? '';
  if (!rest || rest === '/') return NextResponse.next();

  // Sub-pages are verified-only; the read-only preview lives on the landing page
  // and on /t/{code}/menu, which renders without a session on purpose (D2).
  if (rest === '/menu') return NextResponse.next();

  if (!req.cookies.has('tt_session')) {
    const url = req.nextUrl.clone();
    url.pathname = `/t/${tableCode}`;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/t/:code', '/t/:code/:path*'],
};
