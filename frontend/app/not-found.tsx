import { Button, Panel } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="grid min-h-[60dvh] place-items-center px-4">
      <Panel padding="lg" className="max-w-xl text-center">
        <p className="text-lg font-medium text-brand">404</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Nothing here yet</h1>
        <p className="mt-3 text-xl text-ink-muted">This page doesn&apos;t exist, or it&apos;s still being built.</p>
        <Button href="/dashboard" className="mt-8">
          Back to dashboard
        </Button>
      </Panel>
    </div>
  );
}
