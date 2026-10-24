"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentFeed } from "@/components/agents/AgentFeed";
import { AgentStatsStrip, LearnedProfile } from "@/components/agents/AgentOverview";
import { CommandBar } from "@/components/agents/CommandBar";
import { Em, Icon, Panel, SectionLabel, Segmented, SkyHeader, StatusBadge, type IconName } from "@/components/ui";
import { api } from "@/lib/api";
import {
  AGENT_LABEL,
  AGENT_ROLE,
  BEE_SPECIES,
  timeAgo,
  type AgentKind,
  type AgentRun,
} from "@/lib/agents";
import { cn } from "@/lib/cn";

const TEAM: { kind: AgentKind; icon: IconName }[] = [
  { kind: "scout", icon: "radio" },
  { kind: "producer", icon: "scissors" },
  { kind: "publisher", icon: "send" },
  { kind: "command", icon: "sparkles" },
];

type Filter = "all" | AgentKind;

export default function HivePage() {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const q = filter === "all" ? "" : `&kind=${filter}`;
      const data = await api<AgentRun[]>(`/api/agents/runs?limit=40${q}`);
      setRuns(data);
      setOpen((current) => current ?? data[0]?.id ?? null);
    } catch {
      setRuns([]);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-12">
      <SkyHeader
        eyebrow="The Colony"
        title={
          <>
            Meet your <Em>Bees</Em>
          </>
        }
        description="Four specialist bees work tirelessly for your hive: the Scout Bee finds streams, the Worker Bee harvests and cuts moments, the Honey Bee captions and pollinates feeds, and the Queen Bee coordinates your commands. Here is everything the swarm did, and why."
      />

      <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {TEAM.map(({ kind, icon }) => (
          <li key={kind}>
            <Panel padding="sm" className="flex h-full items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand-strong">
                <Icon name={icon} className="size-6" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="block font-display text-xl font-semibold tracking-tight text-ink">
                    {AGENT_LABEL[kind]}
                  </span>
                </span>
                <span className="text-meta font-medium tracking-wide text-brand-strong">
                  {BEE_SPECIES[kind]}
                </span>
                <span className="mt-1 block text-base text-ink-muted">
                  {AGENT_ROLE[kind]}
                </span>
              </span>
            </Panel>
          </li>
        ))}
      </ul>

      <section className="space-y-6">
        <SectionLabel>Command the Hive</SectionLabel>
        <CommandBar onStarted={() => load()} />
      </section>

      <AgentStatsStrip />
      <LearnedProfile />

      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <SectionLabel>Swarm Activity</SectionLabel>
          <Segmented
            label="Filter by bee"
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setOpen(null);
            }}
            options={[
              { value: "all", label: "All Bees" },
              { value: "scout", label: "Scout Bee" },
              { value: "producer", label: "Worker Bee" },
              { value: "publisher", label: "Honey Bee" },
              { value: "command", label: "Queen Bee" },
            ]}
          />
        </div>

        {runs === null ? (
          <p className="text-lg text-ink-muted">Loading hive activity…</p>
        ) : runs.length === 0 ? (
          <Panel tone="sunken" padding="lg" className="text-center">
            <p className="font-display text-2xl font-semibold tracking-tight text-ink">No bee activity yet</p>
            <p className="mt-2 text-lg text-ink-muted">Start a project, command the Queen Bee, or press “Check now” on a channel.</p>
          </Panel>
        ) : (
          <ul className="space-y-4">
            {runs.map((run) => {
              const expanded = open === run.id;
              return (
                <li key={run.id}>
                  <Panel padding="none" className="overflow-hidden">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : run.id)}
                      className="flex w-full items-start gap-4 px-6 py-5 text-left hover:bg-surface-sunken"
                    >
                      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand-strong">
                        <Icon name={TEAM.find((t) => t.kind === run.kind)?.icon ?? "bee"} className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-3">
                          <span className="font-display text-xl font-semibold tracking-tight text-ink">
                            {AGENT_LABEL[run.kind]}
                          </span>
                          <StatusBadge status={run.status === "failed" ? "failed" : run.status} />
                          <span className="text-meta text-ink-faint">{timeAgo(run.started_at)}</span>
                        </span>
                        <span className="mt-1 block text-base text-ink-muted [overflow-wrap:anywhere]">
                          {run.summary || run.goal}
                        </span>
                      </span>
                      <Icon
                        name="chevronDown"
                        className={cn(
                          "mt-2 size-5 shrink-0 text-ink-faint transition-transform duration-(--motion-fast)",
                          expanded && "rotate-180",
                        )}
                      />
                    </button>
                    {expanded && (
                      <div className="border-t border-line px-6 py-5">
                        <AgentFeed runId={run.id} />
                      </div>
                    )}
                  </Panel>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
