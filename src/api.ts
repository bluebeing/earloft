const TOKEN_KEY = 'podcasty.token';

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* privátní režim */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${getToken()}`);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('podcasty:unauthorized'));
    throw new ApiError(401, 'Neplatný přístupový token');
  }
  if (!res.ok && res.status !== 304) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* není JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return res;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  return (await api(path, init)).json() as Promise<T>;
}
