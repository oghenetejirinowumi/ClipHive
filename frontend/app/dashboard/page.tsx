import type { Metadata } from "next";
import Link from "next/link";
import { SkyBackground } from "@/components/effects";
import { Greeting } from "@/components/shell/Greeting";
import { Button, Icon, Panel, SectionLabel, ToneSteps } from "@/components/ui";
import { APP_NAV } from "@/lib/routes";

export const metadata: Metadata = { title: "Dashboard" };

const SECTIONS = APP_NAV.filter((item) => item.href !== "/dashboard");

// Mirrors backend ClipStatus (processing → captioning → ready) and PostStatus (posted).
const LIFECYCLE = [
  { eyebrow: "01 · processing", title: "Found & cut", body: "Highlight scored, trimmed and cropped to 9:16." },
  { eyebrow: "02 · captioning", title: "Captioned", body: "Word-timed captions burned in your style." },
  { eyebrow: "03 · ready", title: "In the hub", body: "Preview, tweak the title, download." },
  { eyebrow: "04 · posted", title: "Live", body: "Sent to TikTok, Shorts, Reels or X." },
];

export default function DashboardPage() {
  return (
    <div className="space-y-14">
      <section className="relative isolate overflow-hidden rounded-xl px-8 pt-12 pb-24 lg:px-14 lg:pt-16 lg:pb-32">
        <SkyBackground />
        <SectionLabel inverse>Dashboard</SectionLabel>
        <h1 className="mt-4 font-display text-5xl font-semibold tracking-tight [overflow-wrap:anywhere] text-on-brand lg:text-7xl">
          <Greeting />
        </h1>
        <p className="mt-4 max-w-2xl text-xl text-on-brand/85 lg:text-2xl">Here&apos;s where everything lives. Start by adding a streamer.</p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button href="/streamers" variant="inverse" size="lg">
            Add a streamer <Icon name="arrowRight" />
          </Button>
          <Button href="/hub" variant="ghostInverse" size="lg">
            Open the hub
          </Button>
        </div>
      </section>

      <section className="space-y-6">
        <SectionLabel>Workspace</SectionLabel>
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
      </section>

      <section className="space-y-6">
        <SectionLabel>How a clip moves</SectionLabel>
        <ToneSteps steps={LIFECYCLE} />
      </section>
    </div>
  );
}
