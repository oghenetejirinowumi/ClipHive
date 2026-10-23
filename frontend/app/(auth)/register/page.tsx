import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { AuthFrame } from "@/components/ui";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <AuthFrame
      title="Create your account"
      subtitle="Add a streamer and your first captioned clips land in the hub."
      footer={
        <>
          Already have an account?{" "}
          <Link href={loginHref} className="inline-flex min-h-11 items-center font-medium text-brand hover:text-brand-strong">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm next={next} />
    </AuthFrame>
  );
}
