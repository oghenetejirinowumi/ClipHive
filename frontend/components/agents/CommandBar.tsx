"use client";

import { useState, type FormEvent } from "react";
import { Button, Icon, Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { CommandPlan } from "@/lib/agents";
import type { ImportJob } from "@/lib/imports";

const EXAMPLES = ["Make 3 funny clips from my last stream for YouTube Shorts", "5 hype clips, 20 seconds, Punch captions, from my latest VOD"];

/** "Tell the agents what you want": text → a plan to confirm → an import the Producer runs. */
export function CommandBar({ onStarted }: { onStarted?: (job: ImportJob) => void }) {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<CommandPlan | null>(null);
  const [busy, setBusy] = useState<"plan" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);

  async function makePlan(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length < 3) return;
    setBusy("plan");
    setError(null);
    setStarted(null);
    try {
      setPlan(await api<CommandPlan>("/api/agents/command", { method: "POST", body: { text: text.trim() } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!plan) return;
    setBusy("run");
    setError(null);
    try {
      const job = await api<ImportJob>("/api/agents/command/run", { method: "POST", body: plan });
      setStarted(plan.summary);
      setPlan(null);
      setText("");
      onStarted?.(job);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start that.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={makePlan} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="agent-command" className="sr-only">
          Tell the agents what you want
        </label>
        <div className="relative flex-1">
          <Icon name="bot" className="pointer-events-none absolute top-1/2 left-5 size-6 -translate-y-1/2 text-ink-faint" />
          <input
            id="agent-command"
            type="text"
            autoComplete="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPlan(null);
            }}
            placeholder={EXAMPLES[0]}
            className="block h-16 w-full rounded-full border border-line-strong bg-surface pr-6 pl-14 text-lg text-ink transition-[border-color,box-shadow] duration-(--motion-fast) placeholder:text-ink-faint hover:border-ink-faint focus:border-brand focus:shadow-ring focus-visible:outline-none"
          />
        </div>
        <Button type="submit" size="lg" variant="secondary" loading={busy === "plan"} disabled={text.trim().length < 3}>
          <Icon name="sparkles" /> Plan it
        </Button>
      </form>

      {!plan && !started && !error && (
        <p className="text-base text-ink-muted">
          Try:{" "}
          {EXAMPLES.map((ex, i) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className="inline-flex min-h-11 items-center font-medium text-brand hover:text-brand-strong">
              “{ex}”{i < EXAMPLES.length - 1 ? <span className="px-2 text-ink-faint">or</span> : null}
            </button>
          ))}
        </p>
      )}

      {plan && (
        <div className="flex flex-col gap-4 rounded-lg border border-brand/20 bg-brand-subtle p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-meta font-semibold tracking-[0.12em] text-brand-strong uppercase">The plan</p>
            <p className="mt-1 text-lg text-ink [overflow-wrap:anywhere]">{plan.error ?? plan.summary}</p>
          </div>
          <div className="flex shrink-0 gap-3">
            <Button variant="ghost" size="sm" onClick={() => setPlan(null)}>
              Cancel
            </Button>
            {!plan.error && (
              <Button size="sm" loading={busy === "run"} onClick={run}>
                <Icon name="send" className="size-5" /> Go
              </Button>
            )}
          </div>
        </div>
      )}

      {started && (
        <Notice tone="success" onDismiss={() => setStarted(null)}>
          On it: {started}. Watch the Producer below.
        </Notice>
      )}
      {error && (
        <Notice tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
    </div>
  );
}
