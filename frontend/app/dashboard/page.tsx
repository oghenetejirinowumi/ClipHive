import type { Metadata } from "next";
import Link from "next/link";
import { Greeting } from "@/components/shell/Greeting";
import { Icon, Ledger, PageHeader, Panel } from "@/components/ui";
import { APP_NAV } from "@/lib/routes";

export const metadata: Metadata = { title: "Dashboard" };

const SECTIONS = APP_NAV.filter((item) => item.href !== "/dashboard");

export default function DashboardPage() {
  return (
    <div className="space-y-12">
      <PageHeader eyebrow="Dashboard" title={<Greeting />} description="Here's where everything lives. Start by adding a streamer." />

      <div className="grid gap-6 sm:grid-cols-2">
        {SECTIONS.map((item) => (
          <Link key={item.href} href={item.href} className="group rounded-lg">
            <Panel interactive className="flex h-full items-start gap-5">
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand-strong">
                <Icon name={item.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-2xl font-semibold tracking-tight text-ink">{item.label}</span>
                <span className="mt-2 block text-lg text-ink-muted">{item.description}</span>
              </span>
              <Icon name="arrowRight" className="mt-1 size-5 text-ink-faint transition-transform duration-(--motion-fast) group-hover:translate-x-0.5" />
            </Panel>
          </Link>
        ))}
      </div>

      <Panel>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">How a clip gets made</h2>
        <Ledger
          className="mt-2"
          items={[
            { label: "1. Watch", value: "Streamers", hint: "We record live segments or pull the latest VOD." },
            { label: "2. Clip", value: "Automatic", hint: "Highlights are scored, cut and cropped to 9:16." },
            { label: "3. Caption", value: "Caption styles", hint: "Word-timed captions in your chosen style." },
            { label: "4. Post", value: "Clip hub", hint: "Auto-post where allowed, or download in one tap." },
          ]}
        />
      </Panel>
    </div>
  );
}
