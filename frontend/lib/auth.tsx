"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { clearSession, readSession, writeSession, type User } from "./session";

export type { User };

/** Response body of POST /auth/login and POST /auth/register (see docs/DESIGN_SYSTEM.md). */
export type AuthResponse = { access_token: string; token_type: "bearer"; user: User };

type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

/** Lets the whole frontend run before the backend's /auth routes exist. */
const AUTH_MOCK = process.env.NEXT_PUBLIC_AUTH_MOCK === "true";

const mockAuth = (email: string): AuthResponse => ({
  access_token: `mock-${Date.now()}`,
  token_type: "bearer",
  user: { id: "mock-user", email },
});

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    const session = readSession();
    setUser(session?.user ?? null);
    setStatus(session ? "authenticated" : "anonymous");
  }, []);

  const authenticate = useCallback(async (path: "/auth/login" | "/auth/register", email: string, password: string) => {
    const res = AUTH_MOCK ? mockAuth(email) : await api<AuthResponse>(path, { method: "POST", body: { email, password }, auth: false });
    writeSession(res.access_token, res.user);
    setUser(res.user);
    setStatus("authenticated");
  }, []);

  const login = useCallback((email: string, password: string) => authenticate("/auth/login", email, password), [authenticate]);
  const register = useCallback((email: string, password: string) => authenticate("/auth/register", email, password), [authenticate]);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(() => ({ user, status, login, register, logout }), [user, status, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
