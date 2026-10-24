"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button, compactInputClass, Icon } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { ChatMessage } from "@/lib/editor";

type Version = { number: number; label: string; created_at: string };

const SUGGESTIONS = [
  "Add captions in the Punch style",
  "Add a big title at the start that says WAIT FOR IT",
  "Cut it down to the best 30 seconds",
  "Slow down the clip under the playhead to 0.5×",
  "Fade the music out over the last 2 seconds",
];

type Props = {
  projectId: number;
  messages: ChatMessage[];
  /** Latest version number; refreshes the history list when it changes. */
  version: number;
  busy: boolean;
  error: string | null;
  onSend(message: string): void;
  onRestore(number: number): void;
};

/** Right panel: the AI agent. Each turn lists what it changed and can be undone or restored. */
export function AgentPanel({ projectId, messages, version, busy, error, onSend, onRestore }: Props) {
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<"chat" | "history">("chat");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Follow the conversation; with no messages, keep the intro and suggestions in view.
    if (messages.length || busy) list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy, view]);

  const loadVersions = useCallback(async () => {
    try {
      setVersions(await api<Version[]>(`/api/editor/projects/${projectId}/versions`));
    } catch {
      setVersions([]);
    }
  }, [projectId]);

  useEffect(() => {
    if (view === "history") loadVersions();
  }, [view, version, loadVersions]);

  function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text);
    setDraft("");
    setView("chat");
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3">
        <p className="flex min-h-11 items-center gap-2 text-meta font-semibold text-ink">
          <Icon name="sparkles" className="size-5 text-brand" /> Agent
        </p>
        <Button size="xs" variant="ghost" aria-pressed={view === "history"} onClick={() => setView((v) => (v === "chat" ? "history" : "chat"))} title="Version history">
          <Icon name="history" className="size-5" /> {view === "history" ? "Chat" : `v${version}`}
        </Button>
      </div>

      {view === "history" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="mb-2 text-meta font-semibold tracking-wide text-ink-muted uppercase">Versions</p>
          {versions === null ? (
            <p className="text-meta text-ink-muted">Loading…</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {versions.map((v) => (
                <li key={v.number} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-10 shrink-0 font-mono text-meta text-ink-muted">v{v.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-meta text-ink">{v.label}</span>
                    <span className="block text-fine text-ink-faint">{new Date(v.created_at).toLocaleString()}</span>
                  </span>
                  {v.number === version && <span className="text-fine font-medium text-ink-faint">latest</span>}
                  {/* The latest version is restorable too: it drops any hand edits made since it was saved. */}
                  <Button size="xs" variant="secondary" disabled={busy} onClick={() => onRestore(v.number)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-meta text-ink-muted">
                Describe the edit you want. The agent changes the timeline, every turn is saved as a version, and you can undo it or keep editing by hand.
              </p>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => onSend(s)}
                    className="tactile rounded-md border border-line bg-paper px-3 py-2 text-left text-meta text-ink hover:border-brand-soft disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[90%] rounded-lg bg-brand px-3 py-2 text-meta whitespace-pre-wrap text-on-brand">{m.content}</p>
              </div>
            ) : (
              <div key={i} className="space-y-2 rounded-lg border border-line bg-surface-sunken p-3">
                {m.changes.length > 0 && (
                  <ul className="space-y-1">
                    {m.changes.map((c, j) => (
                      <li key={j} className="flex gap-2 text-meta text-ink-muted">
                        <Icon name="check" className="mt-0.5 size-5 shrink-0 text-success" />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-meta whitespace-pre-wrap text-ink">{m.content}</p>
                {m.version_from != null && m.version_to != null && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2">
                    <span className="font-mono text-meta text-ink-faint">
                      Changed · v{m.version_from} → v{m.version_to}
                    </span>
                    <button type="button" disabled={busy} onClick={() => onRestore(m.version_from!)} className="text-meta font-medium text-brand hover:underline disabled:opacity-50">
                      Undo this turn
                    </button>
                    {m.version_to !== version && (
                      <button type="button" disabled={busy} onClick={() => onRestore(m.version_to!)} className="text-meta font-medium text-brand hover:underline disabled:opacity-50">
                        Back to v{m.version_to}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ),
          )}

          {busy && (
            <p className="flex items-center gap-2 rounded-lg border border-line bg-surface-sunken p-3 text-meta text-ink-muted">
              <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-current border-r-transparent" />
              Working… captions and transcripts can take a little while.
            </p>
          )}
        </div>
      )}

      {error && <p className="mx-3 mb-2 rounded-md bg-danger-subtle px-3 py-2 text-meta text-danger">{error}</p>}

      <form onSubmit={send} className="border-t border-line p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            maxLength={2000}
            placeholder="Ask anything…"
            aria-label="Message the agent"
            className={cn(compactInputClass, "h-auto min-h-11 flex-1 resize-none py-2")}
          />
          <Button type="submit" size="xs" loading={busy} disabled={!draft.trim()} aria-label="Send">
            <Icon name="send" className="size-5" />
          </Button>
        </div>
        <p className="mt-1 text-fine text-ink-faint">Enter to send · Shift+Enter for a new line</p>
      </form>
    </div>
  );
}
