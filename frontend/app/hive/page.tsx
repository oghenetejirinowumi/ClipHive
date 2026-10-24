"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentFeed } from "@/components/agents/AgentFeed";
import { CommandBar } from "@/components/agents/CommandBar";
import { Bee, BEE_VARIANT, BeeLoader, BeeSwarm, CombLegend, HexBadge, HiveComb, HoneycombLattice, SleepingBee } from "@/components/hive";
import { Em, Icon, Panel, SectionLabel, Segmented, SkyHeader, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { AGENT_LABEL, AGENT_ROLE, timeAgo, type AgentKind, type AgentRun } from "@/lib/agents";
import { cn, cssVars } from "@/lib/cn";

const TEAM: AgentKind[] = ["command", "scout", "producer", "publisher"];

type Filter = "all" | AgentKind;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All bees" },
  { value: "scout", label: "Scout" },
  { value: "producer", label: "Worker" },
  { value: "publisher", label: "Honey" },
  { value: "command", label: "Queen" },
];

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function HivePage() {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number | null>(null);
  // Which bees are mid-job. Learned from whatever list is loaded, so a filter only updates its own bee.
  const [busy, setBusy] = useState<Partial<Record<AgentKind, boolean>>>({});

  const load = useCallback(async () => {
    try {
      const q = filter === "all" ? "" : `&kind=${filter}`;
      const data = await api<AgentRun[]>(`/api/agents/runs?limit=40${q}`);
      setRuns(data);
      setOpen((current) => current ?? data[0]?.id ?? null);
      const kinds = filter === "all" ? TEAM : [filter];
      setBusy((prev) => {
        const next = { ...prev };
        for (const k of kinds) next[k] = data.some((r) => r.kind === k && r.status === "running");
        return next;
      });
    } catch {
      setRuns([]);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  function showBee(kind: AgentKind) {
    setFilter((f) => (f === kind ? "all" : kind));
    setOpen(null);
    document.getElementById("swarm-activity")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function openRun(run: AgentRun) {
    setOpen(run.id);
    // Wait a frame so the opened run has rendered before scrolling to it.
    requestAnimationFrame(() =>
      document.getElementById(`run-${run.id}`)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" }),
    );
  }

  const working = Object.values(busy).filter(Boolean).length;

  return (
    <div className="space-y-12 lg:space-y-14">
      <SkyHeader
        size="lg"
        className="fx-rise"
        eyebrow="The Colony"
        title={
          <>
            Meet your <Em>Bees</Em>
          </>
        }
        decoration={
          <>
            <HoneycombLattice tone="inverse" fade="right" />
            <BeeSwarm count={6} tone="inverse" interactive pollen className="-z-10" />
          </>
        }
        actions={
          <span className="inline-flex min-h-11 items-center gap-3 rounded-full border border-on-brand/30 bg-on-brand/10 px-4 text-base font-medium text-on-brand">
            <span aria-hidden className={cn("hive-pulse", working > 0 && "hive-pulse-on")} />
            {working > 0 ? `${working} ${working === 1 ? "bee" : "bees"} buzzing now` : "The hive is resting"}
          </span>
        }
      />

      {/* The four bees. Tap one to filter the activity to its work. */}
      <ul className="grid gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-4">
        {TEAM.map((kind, i) => {
          const active = filter === kind;
          const isBusy = !!busy[kind];
          return (
            <li key={kind} className="fx-rise" style={cssVars({ "--i": i + 1 })}>
              <button
                type="button"
                onClick={() => showBee(kind)}
                aria-pressed={active}
                className={cn(
                  "tactile flex h-full w-full items-start gap-4 rounded-lg border bg-surface p-5 text-left shadow-glow sm:flex-col sm:p-6",
                  active ? "border-brand" : "border-line",
                )}
              >
                <HexBadge size="sm" glow={isBusy} className="sm:hidden">
                  <Bee variant={BEE_VARIANT[kind]} size={34} flying={isBusy} className="bee-hover" />
                </HexBadge>
                <HexBadge size="lg" glow={isBusy} className="hidden sm:inline-grid">
                  <Bee variant={BEE_VARIANT[kind]} size={54} flying={isBusy} className="bee-hover" />
                </HexBadge>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-display text-xl font-semibold tracking-tight text-ink lg:text-2xl">{AGENT_LABEL[kind]}</span>
                    {isBusy ? <StatusBadge status="running" label="Buzzing" /> : <span className="text-meta text-ink-faint">Resting</span>}
                  </span>
                  <span className="mt-1 block text-base text-ink-muted">{AGENT_ROLE[kind]}</span>
                  <span className="mt-3 inline-flex items-center gap-1 text-meta font-medium text-brand">
                    {active ? "Showing its jobs" : "See its jobs"}
                    <Icon name="arrowRight" className="size-5" />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Live comb: one cell per job. */}
      <section className="fx-rise space-y-5" style={cssVars({ "--i": 5 })}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <SectionLabel>The Comb</SectionLabel>
            <p className="mt-2 text-base text-ink-muted">One cell per job. Tap to open.</p>
          </div>
          <CombLegend />
        </div>
        <Panel padding="none" className="relative isolate overflow-hidden px-4 py-6 sm:px-6">
          <HoneycombLattice fade="bottom" r={18} />
          {runs === null ? (
            <BeeLoader label="Loading…" />
          ) : runs.length === 0 ? (
            <p className="text-base text-ink-muted">No jobs yet.</p>
          ) : (
            <HiveComb runs={runs} activeId={open} onPick={openRun} />
          )}
        </Panel>
      </section>

      <section className="space-y-6">
        <SectionLabel>Ask the Queen Bee</SectionLabel>
        <CommandBar onStarted={() => load()} />
      </section>

      <section id="swarm-activity" className="scroll-mt-24 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <SectionLabel>Swarm Activity</SectionLabel>
          {/* Five options are wider than a phone: let the strip scroll sideways there. */}
          <div className="-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:px-0">
            <Segmented
              label="Filter by bee"
              value={filter}
              onChange={(v) => {
                setFilter(v);
                setOpen(null);
              }}
              options={FILTERS}
            />
          </div>
        </div>

        {runs === null ? (
          <BeeLoader label="Loading activity…" />
        ) : runs.length === 0 ? (
          <Panel tone="sunken" padding="lg" className="flex flex-col items-center text-center">
            <SleepingBee />
            <p className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink">No activity yet</p>
            <p className="mt-2 text-lg text-ink-muted">Start a project or send the Queen Bee a request.</p>
          </Panel>
        ) : (
          <ul className="space-y-4">
            {runs.map((run, i) => {
              const expanded = open === run.id;
              const running = run.status === "running";
              return (
                <li key={run.id} id={`run-${run.id}`} className="fx-rise scroll-mt-24" style={cssVars({ "--i": Math.min(i, 8) })}>
                  <Panel padding="none" className={cn("overflow-hidden", expanded && "border-brand-soft")}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : run.id)}
                      className="flex w-full items-start gap-4 px-4 py-4 text-left hover:bg-surface-sunken sm:px-6 sm:py-5"
                    >
                      <HexBadge size="sm" glow={running}>
                        <Bee variant={BEE_VARIANT[run.kind]} size={32} flying={running} />
                      </HexBadge>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-display text-xl font-semibold tracking-tight text-ink">{AGENT_LABEL[run.kind]}</span>
                          <StatusBadge status={run.status === "failed" ? "failed" : run.status} />
                          <span className="text-meta text-ink-faint">{timeAgo(run.started_at)}</span>
                        </span>
                        <span className="mt-1 block text-base text-ink-muted [overflow-wrap:anywhere]">{run.summary || run.goal}</span>
                      </span>
                      <Icon
                        name="chevronDown"
                        className={cn("mt-2 size-5 shrink-0 text-ink-faint transition-transform duration-(--motion-fast)", expanded && "rotate-180")}
                      />
                    </button>
                    {expanded && (
                      <div className="fx-rise border-t border-line px-4 py-5 sm:px-6">
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
