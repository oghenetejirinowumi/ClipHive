"use client";

import { useAuth } from "@/lib/auth";

export function Greeting() {
  const { user } = useAuth();
  const name = user?.email.split("@")[0];
  return <>{name ? `Welcome, ${name}` : "Welcome"}</>;
}
