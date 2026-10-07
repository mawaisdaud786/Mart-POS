/**
 * Talking to the shop server. The access token lives only in this module's memory (never in browser
 * storage); the long-lived sign-in is an HttpOnly cookie that scripts cannot read.
 */

export interface ApiSession {
  accessToken: string;
  expiresIn: number;
  user: { id: string; name: string; email: string | null; phone: string | null };
  tenant: { id: string; name: string; slug: string };
  membership: { id: string; roleId: string; roleName: string };
  permissions: string[];
  features: string[];
  subscription: { status: string; readOnly: boolean; periodEnd: string | null };
}

export interface TenantChoice {
  tenantId: string;
  name: string;
  role: string;
}

export type LoginResult = { status: 'ok'; session: ApiSession } | { status: 'choose_tenant'; tenants: TenantChoice[] };

/** A request the server refused: `message` is safe to show to the person using the app. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
let accessToken: string | null = null;
let refreshInFlight: Promise<ApiSession> | null = null;

export const hasAccessToken = () => accessToken !== null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function errorFrom(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { title?: string; message?: string; code?: string; errors?: { path: string; message: string }[] };
    const detail = body.errors?.[0]?.message;
    return new ApiError(detail && body.code === 'VALIDATION_FAILED' ? detail : (body.title ?? body.message ?? `Request failed (${response.status})`), response.status, body.code);
  } catch {
    return new ApiError(response.status === 0 ? 'Cannot reach the shop server. Check your internet connection.' : `Request failed (${response.status})`, response.status);
  }
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${apiBase}${path.startsWith('/') ? path : `/${path}`}`, init);
  } catch {
    throw new ApiError('Cannot reach the shop server. Check your internet connection.', 0, 'NETWORK');
  }
}

export async function loginWithPassword(input: { identifier: string; password: string; tenantId?: string }): Promise<LoginResult> {
  const response = await send('/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await errorFrom(response);
  const result = (await response.json()) as LoginResult;
  if (result.status === 'ok') accessToken = result.session.accessToken;
  return result;
}

/** Restore the session from the HttpOnly cookie (page reload) or renew an expiring access token. */
export function refreshApiSession(): Promise<ApiSession> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await send('/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'retailos' } });
        if (!response.ok) throw await errorFrom(response);
        const session = (await response.json()) as ApiSession;
        accessToken = session.accessToken;
        return session;
      } catch (error) {
        accessToken = null;
        throw error;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function logoutApiSession() {
  await send('/auth/logout', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'retailos' } }).catch(() => undefined);
  accessToken = null;
}

export async function apiRequest<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const attempt = () => {
    if (!accessToken) throw new ApiError('Sign in to the shop server first', 401, 'NO_SESSION');
    const headers = new Headers(rest.headers);
    headers.set('Authorization', 'Bearer ' + accessToken);
    headers.set('X-Requested-With', 'retailos');
    if (json !== undefined) headers.set('Content-Type', 'application/json');
    return send(path, { ...rest, headers, credentials: 'include', ...(json !== undefined ? { body: JSON.stringify(json) } : {}) });
  };

  let response = await attempt();
  if (response.status === 401) {
    await refreshApiSession();
    response = await attempt();
  }
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}
