"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Icon, type IconName } from "@/components/ui";
import { api } from "@/lib/api";
import { AGENT_LABEL, type AgentEvent, type AgentRun } from "@/lib/agents";
import { cn } from "@/lib/cn";

type Look = { icon: IconName; dot: string; text: string };

function look(e: AgentEvent): Look {
  if (e.type === "decision" && e.detail?.verdict === "kept") return { icon: "check", dot: "bg-success-subtle text-success", text: "text-ink font-medium" };
  if (e.type === "decision") return { icon: "x", dot: "bg-surface-sunken text-ink-muted", text: "text-ink-muted" };
  if (e.type === "error") return { icon: "alert", dot: "bg-danger-subtle text-danger", text: "text-danger" };
  if (e.type === "done") return { icon: "sparkles", dot: "bg-brand-subtle text-brand-strong", text: "text-ink font-medium" };
  if (e.type === "tool_call") return { icon: "search", dot: "bg-brand-subtle text-brand-strong", text: "text-ink" };
  return { icon: "bot", dot: "bg-surface-sunken text-ink-muted", text: "text-ink-muted italic" };
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Extra facts for a kept clip: its packaging. */
function KeptExtras({ e }: { e: AgentEvent }) {
  const tags = Array.isArray(e.detail?.hashtags) ? (e.detail?.hashtags as string[]) : [];
  const style = typeof e.detail?.caption_style === "string" ? e.detail.caption_style : null;
  if (!tags.length && !style) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {style && <Badge size="sm">{style} captions</Badge>}
      {tags.slice(0, 5).map((t) => (
        <Badge key={t} tone="brand" size="sm">
          {t}
        </Badge>
      ))}
    </div>
  );
}

/**
 * Live timeline of what an agent is doing and why. Give it a run id, or an import job id
 * (it finds that job's Producer run). Polls every second while the run is working.
 */
export function AgentFeed({
  runId: givenRunId,
  importJobId,
  compact = false,
  className,
}: {
  runId?: number;
  importJobId?: number;
  compact?: boolean;
  className?: string;
}) {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [missing, setMissing] = useState(false);
  const lastSeq = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);

  // Find the run (and keep looking until a job's Producer run exists).
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    lastSeq.current = 0;
    setEvents([]);
    setRun(null);

    async function find() {
      try {
        if (givenRunId) {
          const r = await api<AgentRun>(`/api/agents/runs/${givenRunId}`);
          if (alive) setRun(r);
          return;
        }
        if (importJobId) {
          const runs = await api<AgentRun[]>(`/api/agents/runs?import_job_id=${importJobId}&kind=producer&limit=1`);
          if (!alive) return;
          if (runs[0]) setRun(runs[0]);
          else timer = setTimeout(find, 1500);
        }
      } catch {
        if (alive) setMissing(true);
      }
    }
    find();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [givenRunId, importJobId]);

  // Stream its events.
  const runKey = run?.id;
  const running = run?.status === "running";
  useEffect(() => {
    if (!runKey) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const fresh = await api<AgentEvent[]>(`/api/agents/runs/${runKey}/events?after=${lastSeq.current}`);
        if (!alive) return;
        if (fresh.length) {
          lastSeq.current = fresh[fresh.length - 1].seq;
          setEvents((prev) => [...prev, ...fresh]);
        }
        const r = await api<AgentRun>(`/api/agents/runs/${runKey}`);
        if (!alive) return;
        setRun(r);
        if (r.status === "running") timer = setTimeout(poll, 1000);
      } catch {
        if (alive) timer = setTimeout(poll, 3000);
      }
    }
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [runKey]);

  // Keep the newest step in view while it's working.
  useEffect(() => {
    if (running && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [events.length, running]);

  if (missing) return null;
  if (!run) {
    return (
      <p className={cn("flex items-center gap-3 text-base text-ink-muted", className)}>
        <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-current border-r-transparent" />
        Waiting for the agent to start…
      </p>
    );
  }

  const steps = events.filter((e) => e.type !== "done");
  const kept = events.filter((e) => e.type === "decision" && e.detail?.verdict === "kept").length;
  const rejected = events.filter((e) => e.type === "decision" && e.detail?.verdict === "rejected").length;

  return (
    <section aria-label={`${AGENT_LABEL[run.kind]} agent activity`} className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand" size="sm">
          <Icon name="bot" className="size-5" />
          {AGENT_LABEL[run.kind]} agent
        </Badge>
        {run.status === "running" ? (
          <Badge tone="brand" size="sm">
            <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-current" />
            Working
          </Badge>
        ) : (
          <Badge tone={run.status === "done" ? "success" : "danger"} size="sm">
            {run.status === "done" ? "Done" : "Stopped"}
          </Badge>
        )}
        {(kept > 0 || rejected > 0) && (
          <span className="text-meta text-ink-muted">
            {kept} kept · {rejected} rejected
          </span>
        )}
        {run.model && run.model !== "fallback" && !compact && <span className="text-meta text-ink-faint">{run.model}</span>}
      </div>

      {run.summary && run.status !== "running" && <p className="rounded-md bg-brand-subtle px-5 py-3 text-base text-brand-strong">{run.summary}</p>}

      <ol ref={listRef} aria-live="polite" className={cn("space-y-3 overflow-y-auto pr-1", compact ? "max-h-72" : "max-h-[32rem]")}>
        {steps.map((e) => {
          const l = look(e);
          return (
            <li key={e.id} className="flex gap-3">
              <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", l.dot)}>
                <Icon name={l.icon} className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-base [overflow-wrap:anywhere]", l.text)}>{e.title}</p>
                {e.type === "decision" && e.detail?.verdict === "kept" && !compact && <KeptExtras e={e} />}
                {!compact && <p className="text-meta text-ink-faint tabular-nums">{clock(e.created_at)}</p>}
              </div>
            </li>
          );
        })}
        {run.status === "running" && (
          <li className="flex items-center gap-3 text-base text-ink-muted">
            <span aria-hidden className="grid size-8 place-items-center">
              <span className="size-5 animate-spin rounded-full border-2 border-current border-r-transparent" />
            </span>
            Thinking…
          </li>
        )}
      </ol>
    </section>
  );
}
