import type { Metadata } from "next";
import Link from "next/link";
import { AgentStatsStrip, LearnedProfile } from "@/components/agents/AgentOverview";
import { RecentProjects } from "@/components/projects/RecentProjects";
import { Greeting } from "@/components/shell/Greeting";
import { Button, buttonClass, Icon, Panel, SectionLabel, SkyHeader } from "@/components/ui";
import { APP_NAV } from "@/lib/routes";

export const metadata: Metadata = { title: "Dashboard" };

const SECTIONS = APP_NAV.filter((item) => item.href !== "/dashboard");

export default function DashboardPage() {
  return (
    <div className="space-y-14">
      <SkyHeader
        size="lg"
        eyebrow="Dashboard"
        title={<Greeting />}
        description="Your bees watch your channels, harvest and craft the best moments, and schedule what you approve. You just review."
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
          <SectionLabel>The Hive</SectionLabel>
          <Link href="/hive" className={buttonClass({ variant: "ghost", size: "sm" })}>
            See the colony <Icon name="arrowRight" className="size-5" />
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
    </div>
  );
}
