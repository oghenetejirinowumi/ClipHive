"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FieldsReveal } from "@/components/effects";
import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { safeNext } from "@/lib/routes";

const MIN_PASSWORD = 8;

type Errors = Partial<Record<"password" | "confirm" | "form", string>>;

export function RegisterForm({ next }: { next?: string }) {
  const { register } = useAuth();
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    const found: Errors = {};
    if (password.length < MIN_PASSWORD) found.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (password !== form.get("confirm")) found.confirm = "Passwords don't match.";
    setErrors(found);
    if (Object.keys(found).length) return;

    setPending(true);
    try {
      await register(email, password);
      router.replace(safeNext(next));
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : "Couldn't reach the server. Try again." });
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <FieldsReveal className="space-y-6">
        <Field name="email" type="email" label="Email" autoComplete="email" required />
        <Field
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          error={errors.password}
          required
        />
        <Field name="confirm" type="password" label="Confirm password" autoComplete="new-password" error={errors.confirm} required />
        <div aria-live="polite">{errors.form && <p className="rounded-md bg-danger-subtle px-5 py-4 text-base text-danger">{errors.form}</p>}</div>
        <Button type="submit" size="lg" loading={pending} className="w-full">
          Create account
        </Button>
      </FieldsReveal>
    </form>
  );
}
