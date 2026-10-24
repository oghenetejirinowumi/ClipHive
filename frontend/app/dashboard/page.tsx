import type { Metadata } from "next";
import Link from "next/link";
import { AgentStatsStrip, LearnedProfile } from "@/components/agents/AgentOverview";
import { RecentProjects } from "@/components/projects/RecentProjects";
import { Greeting } from "@/components/shell/Greeting";
import { Button, buttonClass, Icon, Panel, SectionLabel, SkyHeader } from "@/components/ui";
import { NAV_GROUPS } from "@/lib/routes";

export const metadata: Metadata = { title: "Dashboard" };

const SECTIONS = NAV_GROUPS.filter((g) => g.id !== "home");

export default function DashboardPage() {
  return (
    <div className="space-y-12">
      <SkyHeader
        size="lg"
        eyebrow="Dashboard"
        title={<Greeting />}
        description="Your agents watch your channels, pick and cut the best moments, and schedule what you approve. You just review."
        actions={
          <>
            <Button href="/inbox" variant="inverse" size="lg">
              <Icon name="inbox" /> Review clips
            </Button>
            <Button href="/create" variant="ghostInverse" size="lg">
              <Icon name="plus" /> Start a project
            </Button>
          </>
        }
      />

      <section className="space-y-8">
        <div className="flex items-center justify-between gap-4">
          <SectionLabel>Your agents</SectionLabel>
          <Link href="/agents" className={buttonClass({ variant: "ghost", size: "sm" })}>
            See their work <Icon name="arrowRight" className="size-5" />
          </Link>
        </div>
        <AgentStatsStrip />
        <LearnedProfile />
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <SectionLabel>Recent projects</SectionLabel>
          <Link href="/create" className={buttonClass({ variant: "ghost", size: "sm" })}>
            See all <Icon name="arrowRight" className="size-5" />
          </Link>
        </div>
        <RecentProjects />
      </section>

      <section className="space-y-6">
        <SectionLabel>Workspace</SectionLabel>
        <div className="grid gap-6 sm:grid-cols-2">
          {SECTIONS.map((g) => (
            <Panel key={g.id} className="flex h-full flex-col gap-4">
              <div className="flex items-start gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand-strong">
                  <Icon name={g.icon} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-2xl font-semibold tracking-tight text-ink">{g.label}</span>
                  <span className="mt-1 block text-base text-ink-muted">{g.description}</span>
                </span>
              </div>
              <ul className="mt-auto flex flex-wrap gap-2">
                {g.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className={buttonClass({ variant: "secondary", size: "xs" })}>
                      <Icon name={item.icon} className="size-5" /> {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      </section>
    </div>
  );
}
