"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FieldsReveal } from "@/components/effects";
import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { safeNext } from "@/lib/routes";

export function LoginForm({ next }: { next?: string }) {
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await login(String(form.get("email")), String(form.get("password")));
      router.replace(safeNext(next));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <FieldsReveal className="space-y-6">
        <Field name="email" type="email" label="Email" autoComplete="email" required />
        <Field name="password" type="password" label="Password" autoComplete="current-password" required />
        <div aria-live="polite">{error && <p className="rounded-md bg-danger-subtle px-5 py-4 text-base text-danger">{error}</p>}</div>
        <Button type="submit" size="lg" loading={pending} className="w-full">
          Sign in
        </Button>
      </FieldsReveal>
    </form>
  );
}
