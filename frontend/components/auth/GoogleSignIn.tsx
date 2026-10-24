"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { safeNext } from "@/lib/routes";
import { useThemeMode } from "@/lib/theme-mode";

/** The slice of Google Identity Services (accounts.google.com/gsi/client) this uses. */
type GsiButtonOptions = {
  type: "standard";
  theme: "outline" | "filled_black";
  size: "large";
  text: "continue_with";
  shape: "pill";
  logo_alignment: "center";
  width: number;
};
type Gsi = {
  initialize: (options: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    ux_mode: "popup";
    auto_select: boolean;
    cancel_on_tap_outside: boolean;
    use_fedcm_for_prompt: boolean;
  }) => void;
  renderButton: (parent: HTMLElement, options: GsiButtonOptions) => void;
};
declare global {
  interface Window {
    google?: { accounts: { id: Gsi } };
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";
let gsiScript: Promise<Gsi> | null = null;

/** Load Google's script once per page, however many buttons ask. */
function loadGsi(): Promise<Gsi> {
  gsiScript ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
    const s = document.createElement("script");
    s.src = GSI_SRC;
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("Google sign-in didn't load")));
    s.onerror = () => {
      gsiScript = null; // allow a retry on the next visit
      reject(new Error("Couldn't reach Google. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return gsiScript;
}

let clientIdRequest: Promise<string | null> | null = null;
const googleClientId = () =>
  (clientIdRequest ??= api<{ google_client_id: string | null }>("/api/auth/config", { auth: false })
    .then((c) => c.google_client_id)
    .catch(() => {
      clientIdRequest = null;
      return null;
    }));

/**
 * Google's official "Continue with Google" button (their branding rules require it), plus an
 * "or" divider before the email form. Renders nothing until the backend has GOOGLE_CLIENT_ID.
 * Google hands the browser a signed ID token; the backend verifies it and returns our session.
 */
export function GoogleSignIn({ next }: { next?: string }) {
  const { loginWithGoogle } = useAuth();
  const router = useRouter();
  const { mode } = useThemeMode();
  const slot = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    googleClientId().then(setClientId);
  }, []);

  // Keep the latest handler without re-initialising Google on every render.
  const onCredential = useRef<(credential: string) => void>(() => {});
  onCredential.current = async (credential: string) => {
    setPending(true);
    setError(null);
    try {
      await loginWithGoogle(credential);
      router.replace(safeNext(next));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Google sign-in failed. Please try again.");
      setPending(false);
    }
  };

  useEffect(() => {
    if (!clientId || !slot.current) return;
    const el = slot.current;
    let cancelled = false;
    loadGsi()
      .then((gsi) => {
        if (cancelled) return;
        gsi.initialize({
          client_id: clientId,
          callback: ({ credential }) => onCredential.current(credential),
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
        });
        el.replaceChildren();
        gsi.renderButton(el, {
          type: "standard",
          theme: mode === "dark" ? "filled_black" : "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "center",
          width: Math.min(400, Math.max(240, Math.floor(el.clientWidth))), // Google caps it at 400px
        });
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, mode]);

  if (!clientId) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div ref={slot} aria-busy={pending} className={pending ? "pointer-events-none flex min-h-11 justify-center opacity-60" : "flex min-h-11 justify-center"} />
        <div aria-live="polite">{error && <p className="rounded-md bg-danger-subtle px-5 py-4 text-base text-danger">{error}</p>}</div>
      </div>
      <div className="flex items-center gap-4 text-base text-ink-muted" role="separator" aria-label="or">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
