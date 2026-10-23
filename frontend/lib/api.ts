import { clearSession, getToken } from "./session";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type ApiInit = Omit<RequestInit, "body"> & {
  /** Plain objects/arrays are sent as JSON; FormData, Blob, strings etc. go as-is. */
  body?: BodyInit | Record<string, unknown> | unknown[] | null;
  /** Attach the signed-in user's bearer token (default true). */
  auth?: boolean;
  /** On 401, send the user to /login (default true). The session is cleared either way. */
  redirectOn401?: boolean;
};

export const apiUrl = (path: string) => `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;

const isPlainJson = (body: unknown): body is Record<string, unknown> | unknown[] =>
  Array.isArray(body) || (typeof body === "object" && body !== null && Object.getPrototypeOf(body) === Object.prototype);

/**
 * Fetch wrapper for the FastAPI backend. Usage: `await api<Clip[]>("/hub/clips")`.
 * Throws ApiError with FastAPI's `detail` message on non-2xx. An authenticated request
 * that gets a 401 clears the session and sends the user to /login.
 */
export async function api<T = unknown>(
  path: string,
  { body, auth = true, redirectOn401 = true, headers, ...init }: ApiInit = {},
): Promise<T> {
  const token = auth ? getToken() : null;
  const json = isPlainJson(body);

  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(body) : (body as BodyInit | null | undefined),
  });

  if (!res.ok) {
    if (res.status === 401 && token) {
      clearSession();
      if (redirectOn401) window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
    }
    let message = res.statusText || "Request failed";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") message = data.detail;
      // FastAPI validation errors (422): [{ loc, msg }, ...]
      else if (Array.isArray(data?.detail) && typeof data.detail[0]?.msg === "string") message = data.detail[0].msg;
    } catch {}
    throw new ApiError(res.status, message);
  }

  return (res.status === 204 ? undefined : await res.json()) as T;
}
