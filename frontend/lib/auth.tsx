"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { clearSession, readSession, writeSession, type User } from "./session";

export type { User };

/** Response body of POST /api/auth/login, /register and /google (see docs/DESIGN_SYSTEM.md). */
export type AuthResponse = { access_token: string; token_type: "bearer"; user: User };

type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  /** Exchange a Google ID token (from Google Identity Services) for a ClipHive session. */
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    const session = readSession();
    setUser(session?.user ?? null);
    setStatus(session ? "authenticated" : "anonymous");
    if (!session) return;

    // Restore instantly from storage, then confirm the token with the backend.
    // A 401 means it expired or was revoked; a network error keeps the session (backend may be restarting).
    api<User>("/api/auth/me", { redirectOn401: false })
      .then((fresh) => setUser(fresh))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          setUser(null);
          setStatus("anonymous");
        }
      });
  }, []);

  const start = useCallback((res: AuthResponse) => {
    writeSession(res.access_token, res.user);
    setUser(res.user);
    setStatus("authenticated");
  }, []);

  const authenticate = useCallback(
    async (path: "/api/auth/login" | "/api/auth/register", email: string, password: string) =>
      start(await api<AuthResponse>(path, { method: "POST", body: { email, password }, auth: false })),
    [start],
  );

  const loginWithGoogle = useCallback(
    async (credential: string) => start(await api<AuthResponse>("/api/auth/google", { method: "POST", body: { credential }, auth: false })),
    [start],
  );

  const login = useCallback((email: string, password: string) => authenticate("/api/auth/login", email, password), [authenticate]);
  const register = useCallback((email: string, password: string) => authenticate("/api/auth/register", email, password), [authenticate]);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(() => ({ user, status, login, register, loginWithGoogle, logout }), [user, status, login, register, loginWithGoogle, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
