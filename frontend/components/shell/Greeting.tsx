"use client";

import { Em } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export function Greeting() {
  const { user } = useAuth();
  const name = user?.email.split("@")[0];
  return name ? (
    <>
      Welcome back, <Em>{name}</Em>
    </>
  ) : (
    <>Welcome back</>
  );
}
