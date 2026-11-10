export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export class ApiError extends Error {
  status: number;
  code?: string;
  /** raw JSON body, so callers can read extra fields (e.g. attemptsLeft) */
  payload?: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, payload?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'same-origin',
  });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON */
  }

  if (!res.ok || !payload?.ok) {
    throw new ApiError(
      payload?.error ?? `Request failed (${res.status})`,
      res.status,
      payload?.code,
      payload ?? undefined,
    );
  }
  return payload.data as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  del: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'DELETE', body: JSON.stringify(body ?? {}) }),
};
