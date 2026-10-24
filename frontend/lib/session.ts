import { SESSION_COOKIE } from "./routes";

export type User = { id: string | number; email: string; name?: string | null; avatar_url?: string | null; created_at?: string | null };

const USER_KEY = "ch_user";
const MAX_AGE_S = 60 * 60 * 24 * 7;

export function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function readSession(): { token: string; user: User } | null {
  const token = getToken();
  if (!token) {
    clearSession();
    return null;
  }
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) return { token, user: JSON.parse(raw) as User };
  } catch {
    // Storage blocked or corrupt — treat as signed out.
  }
  clearSession();
  return null;
}

export function writeSession(token: string, user: User): void {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE_S}; SameSite=Lax${secure}`;
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // The cookie alone still gates routes; the user's email just won't show.
  }
}

export function clearSession(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  try {
    localStorage.removeItem(USER_KEY);
  } catch {}
}
