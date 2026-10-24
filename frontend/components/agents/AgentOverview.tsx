"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, buttonClass, Icon, Panel, StatStrip } from "@/components/ui";
import { api } from "@/lib/api";
import type { AgentStats, Profile } from "@/lib/agents";

/** Headline numbers for the bees in the hive. */
export function AgentStatsStrip() {
  const [stats, setStats] = useState<AgentStats | null>(null);
  useEffect(() => {
    api<AgentStats>("/api/agents/stats")
      .then(setStats)
      .catch(() => undefined);
  }, []);
  const v = (n: number | undefined) => (stats ? n : "–");
  return (
    <StatStrip
      stats={[
        { value: v(stats?.clips_kept), label: "Clips crafted by the bees" },
        { value: v(stats?.moments_rejected), label: "Weak moments filtered out" },
        { value: v(stats?.awaiting_review), label: "Waiting for your review" },
        { value: v(stats?.posts_scheduled), label: "Posts scheduled by swarm" },
      ]}
    />
  );
}

/** "What your bees have learned": the creator profile built from edits and rejections. */
export function LearnedProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    api<Profile>("/api/agents/profile")
      .then(setProfile)
      .catch(() => setProfile({ summary: "", feedback_count: 0, updated_at: null }));
  }, []);

  async function reset() {
    if (!window.confirm("Forget everything the bees learned from your edits?")) return;
    setResetting(true);
    try {
      await api("/api/agents/profile", { method: "DELETE" });
      setProfile({ summary: "", feedback_count: 0, updated_at: null });
    } finally {
      setResetting(false);
    }
  }

  return (
    <Panel tone="brand" padding="md" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 font-display text-2xl font-semibold tracking-tight text-ink">
          <Icon name="sparkles" className="size-6 text-brand-strong" /> What your bees have learned
        </h2>
        {profile && profile.feedback_count > 0 && (
          <Button variant="ghost" size="sm" loading={resetting} onClick={reset}>
            Reset
          </Button>
        )}
      </div>
      {profile === null ? (
        <p className="text-lg text-ink-muted">Loading…</p>
      ) : profile.summary ? (
        <>
          <p className="text-lg text-ink">{profile.summary}</p>
          <p className="text-base text-ink-muted">
            From {profile.feedback_count} edit{profile.feedback_count === 1 ? "" : "s"} and decision{profile.feedback_count === 1 ? "" : "s"}. The Worker Bee reads this before every run to match your style.
          </p>
        </>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-lg text-ink-muted">Nothing yet. Reject clips with a reason, or change a caption style or title, and the bees adapt to your taste.</p>
          <Link href="/inbox" className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}>
            <Icon name="inbox" className="size-5" /> Review clips
          </Link>
        </div>
      )}
    </Panel>
  );
}
