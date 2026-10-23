import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";
import { AuthFrame } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : "/register";

  return (
    <AuthFrame
      title="Welcome back"
      subtitle="Sign in to see today's clips."
      footer={
        <>
          New here?{" "}
          <Link href={registerHref} className="inline-flex min-h-11 items-center font-medium text-brand hover:text-brand-strong">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={next} />
    </AuthFrame>
  );
}
