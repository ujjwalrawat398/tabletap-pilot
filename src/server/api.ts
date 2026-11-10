import 'server-only';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ZodError, type ZodTypeAny, type TypeOf } from 'zod';
import { AuthError } from '@/server/auth';
import { DeviceCapError, SessionError } from '@/server/session';
import { OrderError } from '@/server/repos/orders';
import { CartError } from '@/server/repos/cart';
import { ServiceError } from '@/server/repos/service';
import { GameError } from '@/server/repos/games';

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, { status: 200, ...init });
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/** Maps thrown domain errors to HTTP responses in one place. */
export function handleApiError(err: unknown) {
  if (err instanceof ZodError) {
    return jsonError(err.issues[0]?.message ?? 'Invalid input.', 422, {
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof SessionError) return jsonError(err.message, 401, { code: err.code });
  if (err instanceof AuthError) return jsonError(err.message, err.status, { code: 'AUTH' });
  if (err instanceof OrderError) return jsonError(err.message, err.status);
  if (err instanceof CartError) return jsonError(err.message, 400);
  if (err instanceof ServiceError) return jsonError(err.message, err.status);
  if (err instanceof GameError) return jsonError(err.message, err.status);
  if (err instanceof DeviceCapError) return jsonError(err.message, 409, { code: 'DEVICE_CAP' });

  console.error('[api] unhandled', err);
  const message = err instanceof Error ? err.message : 'Something went wrong.';
  const isProd = process.env.NODE_ENV === 'production';
  return jsonError(isProd ? 'Something went wrong. Please try again.' : message, 500);
}

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<TypeOf<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ZodError([
      { code: 'custom', path: [], message: 'Expected a JSON body.', fatal: true },
    ]);
  }
  return schema.parse(raw);
}

export function clientIp(req: Request) {
  const h = req.headers;
  return (
    h.get('cf-connecting-ip') ??
    h.get('x-real-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  );
}

/** Simple same-origin / CSRF guard for state-changing requests. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return; // same-origin fetches from the app itself
  const host = req.headers.get('host');
  if (!host) return;
  try {
    const originHost = new URL(origin).host;
    if (originHost !== host) throw new AuthError('Cross-origin request blocked.', 403);
  } catch (err) {
    if (err instanceof AuthError) throw err;
  }
}

export async function getCookieHeader() {
  const jar = await cookies();
  return jar.getAll().map((c) => `${c.name}=${c.value}`).join('; ');
}
