"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isAppRoute } from "@/lib/routes";
import { AppShell } from "./AppShell";

/**
 * Wraps app routes (lib/routes.ts APP_NAV) in the shell automatically, so a page added
 * at app/hub/page.tsx needs no layout of its own. Landing and auth pages render bare.
 */
export function ShellGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return isAppRoute(pathname) ? <AppShell>{children}</AppShell> : <>{children}</>;
}
