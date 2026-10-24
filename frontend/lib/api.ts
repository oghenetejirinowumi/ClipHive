import { clearSession, getToken } from "./session";

export const API_URL = (
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL || "")
    : (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000")
).replace(/\/$/, "");

/** What users see whenever something fails for a technical reason (offline, server crash, timeout). */
export const GENERIC_ERROR = "Something went wrong. Please try again.";

// Reads like it was written for developers: setting names (ALL_CAPS_WITH_UNDERSCORES, matched
// case-sensitively so normal titles like "my_video" pass), stack traces, tool and server names.
const SETTING_NAME = /\b[A-Z][A-Z0-9]{2,}_[A-Z0-9_]{2,}\b/;
const TECHNICAL_WORDS = /traceback|exception|errno|\bserver\b|backend|localhost|ffmpeg|yt-dlp|\bapi\b|\.py\b|\bnull\b|\bundefined\b|\bNaN\b|\[object/i;

/** Any message headed for the screen: kept if it reads like plain words, else GENERIC_ERROR. */
export function friendly(text: string | null | undefined): string {
  return !text || SETTING_NAME.test(text) || TECHNICAL_WORDS.test(text) ? GENERIC_ERROR : text;
}

/**
 * The message to show for an error: the backend's own wording when it's a deliberate, user-facing
 * message (4xx, or a 502/503 like "That video is private"), otherwise GENERIC_ERROR. Technical
 * details go to the console, never the screen.
 */
export function userMessage(status: number, detail: string | null | undefined): string {
  if (!detail || status === 0 || status === 500 || status === 504 || status >= 505) return GENERIC_ERROR;
  // FastAPI/Pydantic validation text ("Value error, ...", "Field required") -> plain words
  const text = detail.replace(/^Value error,\s*/i, "").replace(/^Field required$/i, "Please fill in all the fields.");
  return friendly(text);
}

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
  /** Deprecated, ignored: the signed-in user's token is always attached when there is one. */
  auth?: boolean;
  /** On 401, send the user to /login (default true). The session is cleared either way. */
  redirectOn401?: boolean;
};

export const apiUrl = (path: string) => {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (!API_URL) return cleanPath;
  return `${API_URL}${cleanPath}`;
};

const isPlainJson = (body: unknown): body is Record<string, unknown> | unknown[] =>
  Array.isArray(body) || (typeof body === "object" && body !== null && Object.getPrototypeOf(body) === Object.prototype);

/**
 * Fetch wrapper for the FastAPI backend. Usage: `await api<Clip[]>("/hub/clips")`.
 * Throws ApiError with FastAPI's `detail` message on non-2xx. An authenticated request
 * that gets a 401 clears the session and sends the user to /login.
 */
export async function api<T = unknown>(
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `auth` kept so existing calls compile
  { body, auth, redirectOn401 = true, headers, ...init }: ApiInit = {},
): Promise<T> {
  const token = getToken();
  const json = isPlainJson(body);

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: {
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: json ? JSON.stringify(body) : (body as BodyInit | null | undefined),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err; // callers cancel on purpose
    console.error(`Request to ${path} failed:`, err);
    throw new ApiError(0, GENERIC_ERROR);
  }

  if (!res.ok) {
    if (res.status === 401 && token) {
      clearSession();
      if (redirectOn401) window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
    }
    let detail: string | null = null;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") detail = data.detail;
      // FastAPI validation errors (422): [{ loc, msg }, ...]
      else if (Array.isArray(data?.detail) && typeof data.detail[0]?.msg === "string") detail = data.detail[0].msg;
    } catch {}
    if (res.status >= 500) console.error(`${path} -> ${res.status}`, detail);
    throw new ApiError(res.status, userMessage(res.status, detail));
  }

  return (res.status === 204 ? undefined : await res.json()) as T;
}
