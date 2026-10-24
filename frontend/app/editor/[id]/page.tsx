"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentPanel } from "@/components/editor/AgentPanel";
import { Inspector } from "@/components/editor/Inspector";
import { LibraryPanel, type LibraryTab } from "@/components/editor/LibraryPanel";
import { Preview, type PreviewHandle } from "@/components/editor/Preview";
import { Timeline } from "@/components/editor/Timeline";
import { Badge, Button, buttonClass, Icon, Panel, ResizeHandle, Select } from "@/components/ui";
import { api, ApiError, API_URL } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePersistentState } from "@/lib/usePersistentState";
import {
  addText, duplicate, duration, find, formatTime, placeAsset, remove, split, update,
  type Aspect, type Project, type Timeline as TimelineDoc, type Text,
} from "@/lib/editor";

const SAVE_DELAY_MS = 700;
const LIBRARY_MIN = 260;
const LIBRARY_MAX = 520;
const LIBRARY_DEFAULT = 320;
const AGENT_MIN = 300;
const AGENT_MAX = 560;
const AGENT_DEFAULT = 360;
const FPS = 30; // exports render at 30fps; the timecode counts frames at that rate

const FRAMES: { value: Aspect; label: string }[] = [
  { value: "9:16", label: "9:16 · Vertical" },
  { value: "16:9", label: "16:9 · Landscape" },
  { value: "1:1", label: "1:1 · Square" },
  { value: "4:5", label: "4:5 · Portrait" },
];

/** HH:MM:SS:FF at FPS. */
function timecode(seconds: number): string {
  const frames = Math.max(0, Math.floor(seconds * FPS + 1e-6));
  const pad = (n: number) => String(n).padStart(2, "0");
  const s = Math.floor(frames / FPS);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(frames % FPS)}`;
}
const TIMELINE_MIN = 180;
const TIMELINE_MAX = 560;
const TIMELINE_DEFAULT = 340; // fits the ruler + all five lanes

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const COALESCE_MS = 1200;
const MAX_UNDO = 100;

type SaveState = "saved" | "saving" | "unsaved" | "error" | "conflict";

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);

  const [project, setProject] = useState<Project | null>(null);
  const [timeline, setTimeline] = useState<TimelineDoc | null>(null);
  const [title, setTitle] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pxPerSec, setPxPerSec] = useState(40);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("media");
  const [libraryWidth, setLibraryWidth] = usePersistentState("ch_editor_library", LIBRARY_DEFAULT);
  const [agentWidth, setAgentWidth] = usePersistentState("ch_editor_agent", AGENT_DEFAULT);
  const [showLibrary, setShowLibrary] = usePersistentState("ch_editor_show_library", true);
  const [showAgent, setShowAgent] = usePersistentState("ch_editor_show_agent", true);
  const [timelineHeight, setTimelineHeight] = usePersistentState("ch_editor_timeline", TIMELINE_DEFAULT);
  const [dismissedExport, setDismissedExport] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const preview = useRef<PreviewHandle>(null);
  const revision = useRef(0);
  const timelineRef = useRef<TimelineDoc | null>(null);
  const dirty = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStack = useRef<TimelineDoc[]>([]);
  const redoStack = useRef<TimelineDoc[]>([]);
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const textDragBefore = useRef<TimelineDoc | null>(null);
  const [, forceHistory] = useState(0); // re-render so Undo/Redo buttons update

  timelineRef.current = timeline;

  // --- loading & preview -------------------------------------------------------------------
  const refreshPreview = useCallback(async () => {
    try {
      const comp = await api<{ revision: number; html: string }>(`/api/editor/projects/${projectId}/composition`);
      setHtml(comp.html);
    } catch {
      setNotice("Couldn't refresh the preview.");
    }
  }, [projectId]);

  const adopt = useCallback((p: Project, { keepTimeline = false } = {}) => {
    setProject(p);
    revision.current = p.revision;
    if (!keepTimeline) setTimeline(p.timeline);
  }, []);

  useEffect(() => {
    api<Project>(`/api/editor/projects/${projectId}`)
      .then((p) => {
        adopt(p);
        setTitle(p.title);
        refreshPreview();
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Couldn't open this project."));
  }, [projectId, adopt, refreshPreview]);

  // --- saving --------------------------------------------------------------------------------
  const save = useCallback(async (): Promise<void> => {
    if (saving.current) await saving.current; // one save at a time, in order
    if (!dirty.current || !timelineRef.current) return;
    dirty.current = false;
    setSaveState("saving");
    const run = (async () => {
      try {
        const p = await api<Project>(`/api/editor/projects/${projectId}`, {
          method: "PATCH",
          body: { timeline: timelineRef.current, revision: revision.current },
        });
        adopt(p, { keepTimeline: true }); // you may have kept editing while it saved
        setSaveState(dirty.current ? "unsaved" : "saved");
        refreshPreview();
      } catch (err) {
        dirty.current = true;
        if (err instanceof ApiError && err.status === 409) setSaveState("conflict");
        else {
          setSaveState("error");
          setNotice(err instanceof ApiError ? err.message : "Couldn't save. Check your connection.");
        }
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }, [projectId, adopt, refreshPreview]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSaveState("unsaved");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  const flush = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await save();
  }, [save]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  // --- editing with undo -----------------------------------------------------------------
  /** Apply an edit. `coalesce` merges rapid changes to the same field into one undo step. */
  const apply = useCallback(
    (next: TimelineDoc, { before, coalesce }: { before?: TimelineDoc; coalesce?: string } = {}) => {
      const current = timelineRef.current;
      // A drag already shows `next` live, so equal is fine when the pre-drag state is given.
      if (!current || (next === current && !before)) return;
      const now = Date.now();
      const merge = coalesce && lastEdit.current?.key === coalesce && now - lastEdit.current.at < COALESCE_MS;
      if (!merge) {
        undoStack.current = [...undoStack.current, before ?? current].slice(-MAX_UNDO);
        redoStack.current = [];
        forceHistory((n) => n + 1);
      }
      lastEdit.current = coalesce ? { key: coalesce, at: now } : null;
      setTimeline(next);
      timelineRef.current = next;
      scheduleSave();
    },
    [scheduleSave],
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.at(-1);
    if (!prev || !timelineRef.current) return;
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [...redoStack.current, timelineRef.current];
    lastEdit.current = null;
    setTimeline(prev);
    timelineRef.current = prev;
    forceHistory((n) => n + 1);
    if (selectedId && !find(prev, selectedId)) setSelectedId(null);
    scheduleSave();
  }, [scheduleSave, selectedId]);

  const redo = useCallback(() => {
    const next = redoStack.current.at(-1);
    if (!next || !timelineRef.current) return;
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current, timelineRef.current];
    lastEdit.current = null;
    setTimeline(next);
    timelineRef.current = next;
    forceHistory((n) => n + 1);
    scheduleSave();
  }, [scheduleSave]);

  /** The server made an edit (AI, upload): take its timeline, keeping ours as an undo step. */
  const adoptServerEdit = useCallback((p: Project) => {
    const before = timelineRef.current;
    if (before && JSON.stringify(before) !== JSON.stringify(p.timeline)) {
      undoStack.current = [...undoStack.current, before].slice(-MAX_UNDO);
      redoStack.current = [];
      forceHistory((n) => n + 1);
    }
    adopt(p);
    dirty.current = false;
    setSaveState("saved");
    refreshPreview();
  }, [adopt, refreshPreview]);

  // --- actions -------------------------------------------------------------------------------
  const seek = useCallback((t: number) => {
    setPlayhead(t);
    preview.current?.seek(t);
  }, []);

  /** The item to act on: the selection, or the main-track clip under the playhead. */
  const target = useCallback((): string | null => {
    const tl = timelineRef.current;
    if (!tl) return null;
    // The selection wins only when the playhead is inside it; otherwise use what's under the playhead.
    const selected = selectedId ? find(tl, selectedId) : null;
    if (selected && playhead > selected.item.start && playhead < selected.item.start + selected.item.duration) return selectedId;
    const under = tl.clips.filter((c) => c.start <= playhead && c.start + c.duration > playhead).sort((a, b) => a.track - b.track)[0];
    return under?.id ?? null;
  }, [selectedId, playhead]);

  const doSplit = useCallback(() => {
    const tl = timelineRef.current;
    const id = target();
    if (!tl || !id) return;
    const next = split(tl, id, playhead);
    if (next === tl) setNotice("Move the playhead inside the clip to split it.");
    else apply(next);
  }, [apply, playhead, target]);

  const doDelete = useCallback(() => {
    const tl = timelineRef.current;
    if (!tl || !selectedId) return;
    apply(remove(tl, [selectedId]));
    setSelectedId(null);
  }, [apply, selectedId]);

  const doDuplicate = useCallback(() => {
    const tl = timelineRef.current;
    if (!tl || !selectedId) return;
    const result = duplicate(tl, selectedId);
    apply(result.timeline);
    setSelectedId(result.id);
  }, [apply, selectedId]);

  const doAddText = useCallback((preset = "punch") => {
    const tl = timelineRef.current;
    if (!tl) return;
    const result = addText(tl, playhead, preset);
    apply(result.timeline);
    setSelectedId(result.id);
    setLibraryTab("properties");
  }, [apply, playhead]);

  /** A media tile was dropped on the timeline at `at`, on a video track (or the audio lane). */
  const doDropAsset = useCallback((assetId: string, at: number, track: number | undefined) => {
    const tl = timelineRef.current;
    if (!tl) return;
    const result = placeAsset(tl, assetId, at, track);
    if (!result) return;
    apply(result.timeline);
    setSelectedId(result.id);
  }, [apply]);

  /** Go back to a saved version (also how "Undo this turn" works). */
  async function restoreVersion(number: number) {
    setChatBusy(true);
    setChatError(null);
    try {
      await flush(); // keep your latest edits: the server saves them as a version first
      adoptServerEdit(await api<Project>(`/api/editor/projects/${projectId}/versions/${number}/restore`, { method: "POST" }));
      setSelectedId(null);
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : "Couldn't restore that version.");
    } finally {
      setChatBusy(false);
    }
  }

  const doPlace = useCallback((assetId: string) => {
    const tl = timelineRef.current;
    if (!tl) return;
    const result = placeAsset(tl, assetId, playhead);
    if (!result) return;
    apply(result.timeline);
    setSelectedId(result.id);
  }, [apply, playhead]);

  const togglePlay = useCallback(() => {
    if (playing) preview.current?.pause();
    else preview.current?.play();
  }, [playing]);

  async function sendChat(message: string) {
    setChatBusy(true);
    setChatError(null);
    setProject((p) => (p ? { ...p, chat: [...p.chat, { role: "user", content: message, changes: [], at: new Date().toISOString() }] } : p));
    try {
      await flush(); // the AI edits what's saved, so save your latest changes first
      const res = await api<{ reply: string; changes: string[]; project: Project }>(`/api/editor/projects/${projectId}/chat`, {
        method: "POST",
        body: { message, playhead, selected_id: selectedId },
      });
      adoptServerEdit(res.project);
      if (selectedId && !find(res.project.timeline, selectedId)) setSelectedId(null);
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : "The AI editor didn't respond. Try again.");
      setProject((p) => (p ? { ...p, chat: p.chat.slice(0, -1) } : p));
    } finally {
      setChatBusy(false);
    }
  }

  async function exportVideo() {
    try {
      await flush();
      setProject(await api<Project>(`/api/editor/projects/${projectId}/render`, { method: "POST" }));
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Couldn't start the export.");
    }
  }

  // Poll while exporting.
  const rendering = project?.render_status === "rendering";
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(async () => {
      try {
        const p = await api<Project>(`/api/editor/projects/${projectId}`);
        setProject((cur) => (cur ? { ...cur, render_status: p.render_status, render_progress: p.render_progress, render_error: p.render_error, render_path: p.render_path, export_clip_id: p.export_clip_id } : p));
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  }, [rendering, projectId]);

  async function saveTitle() {
    const clean = title.trim();
    if (!project || !clean || clean === project.title) return setTitle(project?.title ?? "");
    try {
      const p = await api<Project>(`/api/editor/projects/${projectId}`, { method: "PATCH", body: { title: clean } });
      setProject((cur) => (cur ? { ...cur, title: p.title } : p));
    } catch {
      setNotice("Couldn't rename the project.");
    }
  }

  // --- keyboard shortcuts ----------------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        doDuplicate();
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === "s" && !mod) {
        doSplit();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        doDelete();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        seek(Math.max(0, playhead + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30)));
      } else if (e.key === "Escape") {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, doDuplicate, togglePlay, doSplit, doDelete, seek, playhead]);

  // --- render ----------------------------------------------------------------------------
  if (loadError) {
    return (
      <Panel padding="lg" className="space-y-4">
        <p className="text-xl text-ink">{loadError}</p>
        <Button href="/editor" variant="secondary">Back to projects</Button>
      </Panel>
    );
  }
  if (!project || !timeline) return <p className="text-lg text-ink-muted">Opening the editor…</p>;

  const selectedText = selectedId ? (timeline.texts.find((t) => t.id === selectedId) as Text | undefined) ?? null : null;
  const total = duration(timeline);

  const doneNotice = project.render_status === "done" && project.render_path && dismissedExport !== project.render_path;
  const captions = timeline.texts.filter((t) => t.is_caption).length;
  const layers = [
    { label: "Clips", count: timeline.clips.length },
    { label: "Text", count: timeline.texts.length - captions },
    { label: "Captions", count: captions },
    { label: "Music", count: timeline.audio.length },
  ];

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-2.5rem)]">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 basis-full items-center gap-1 sm:flex-1 sm:basis-auto">
          <Link href="/editor" className={buttonClass({ variant: "ghost", size: "xs" })} aria-label="Back to projects">
            <Icon name="arrowRight" className="size-5 rotate-180" />
          </Link>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label="Project title"
            maxLength={200}
            className="h-11 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 font-display text-lg font-semibold tracking-tight text-ink hover:border-line focus:border-brand focus:outline-none"
          />
        </div>
        <SaveBadge state={saveState} version={project.version} onReload={() => window.location.reload()} />
        <div className="flex">
          <Button size="xs" variant="ghost" onClick={undo} disabled={!undoStack.current.length} aria-label="Undo" title="Undo (Ctrl+Z)">
            <Icon name="undo" className="size-5" />
          </Button>
          <Button size="xs" variant="ghost" onClick={redo} disabled={!redoStack.current.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <Icon name="redo" className="size-5" />
          </Button>
        </div>
        <div className="hidden lg:flex">
          <Button size="xs" variant="ghost" aria-pressed={showLibrary} onClick={() => setShowLibrary((v) => !v)} aria-label="Toggle library panel" title="Library panel">
            <Icon name="panelLeft" className={cn("size-5", !showLibrary && "opacity-50")} />
          </Button>
          <Button size="xs" variant="ghost" aria-pressed={showAgent} onClick={() => setShowAgent((v) => !v)} aria-label="Toggle agent panel" title="Agent panel">
            <Icon name="panelLeft" className={cn("size-5 -scale-x-100", !showAgent && "opacity-50")} />
          </Button>
        </div>
        <Button size="xs" onClick={exportVideo} loading={rendering} disabled={rendering || total === 0}>
          <Icon name="download" className="size-5" />
          {rendering ? `Exporting ${project.render_progress}%` : "Export"}
        </Button>
      </div>

      {notice && (
        <Strip tone="danger" onDismiss={() => setNotice(null)}>
          {notice}
        </Strip>
      )}
      {doneNotice && (
        <Strip tone="success" onDismiss={() => setDismissedExport(project.render_path)}>
          Exported, and added to your Hub.
          <a href={`${API_URL}/${project.render_path}`} download className="font-medium underline">
            Download MP4
          </a>
          <Link href="/hub" className="font-medium underline">
            Open the Hub
          </Link>
        </Strip>
      )}
      {project.render_status === "failed" && project.render_error && dismissedExport !== project.render_error && (
        <Strip tone="danger" onDismiss={() => setDismissedExport(project.render_error)}>
          Export failed: {project.render_error}
        </Strip>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Library | preview | agent */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-0">
          {showLibrary && (
            <>
              <aside
                className="order-2 flex max-h-[70vh] min-h-80 flex-col overflow-hidden rounded-lg border border-line bg-surface lg:order-none lg:max-h-none lg:min-h-0 lg:w-(--library) lg:shrink-0"
                style={{ "--library": `${clamp(libraryWidth, LIBRARY_MIN, LIBRARY_MAX)}px` } as React.CSSProperties}
              >
                <LibraryPanel
                  tab={libraryTab}
                  onTab={setLibraryTab}
                  projectId={projectId}
                  assets={timeline.assets}
                  beforeServerEdit={flush}
                  onProject={adoptServerEdit}
                  onPlace={doPlace}
                  onAddText={doAddText}
                  onError={setNotice}
                  properties={
                    <Inspector
                      timeline={timeline}
                      selectedId={selectedId}
                      playhead={playhead}
                      onPatch={(itemId, patch, key) => apply(update(timeline, itemId, patch), { coalesce: key })}
                      onProject={(patch: { aspect?: Aspect; background?: string }) => apply({ ...timeline, ...patch }, { coalesce: "project" })}
                      onSplit={doSplit}
                      onDuplicate={doDuplicate}
                      onDelete={doDelete}
                    />
                  }
                />
              </aside>
              <ResizeHandle
                axis="x"
                label="Resize library panel"
                className="hidden lg:block"
                onResize={(d) => setLibraryWidth((w) => clamp(w + d, LIBRARY_MIN, LIBRARY_MAX))}
                onDoubleClick={() => setLibraryWidth(LIBRARY_DEFAULT)}
              />
            </>
          )}

          <section className="order-1 flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-line bg-surface lg:order-none">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1">
              <span className="font-mono text-base text-ink tabular-nums" title="Hours:minutes:seconds:frames">
                {timecode(playhead)}
              </span>
              <span className="text-fine font-medium text-ink-faint">{FPS}FPS</span>
              <div className="flex-1" />
              <Select compact aria-label="Frame" value={timeline.aspect} onChange={(e) => apply({ ...timeline, aspect: e.target.value as Aspect })} className="w-auto">
                {FRAMES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="h-[46vh] min-h-64 p-3 lg:h-auto lg:min-h-0 lg:flex-1">
              <Preview
                ref={preview}
                html={html}
                aspect={timeline.aspect}
                playhead={playhead}
                selectedText={selectedText}
                onTime={setPlayhead}
                onPlayingChange={setPlaying}
                onMoveText={(textId, x, y, commit) => {
                  const tl = timelineRef.current;
                  if (!tl) return;
                  const next = update(tl, textId, { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
                  if (commit) {
                    apply(next, { before: textDragBefore.current ?? undefined });
                    textDragBefore.current = null;
                  } else {
                    textDragBefore.current ??= tl; // undo returns to where the drag started
                    setTimeline(next);
                    timelineRef.current = next;
                  }
                }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-1">
              <div className="flex items-center gap-1">
                <Button size="xs" variant="ghost" onClick={() => seek(0)} aria-label="Go to start" title="Go to start">
                  <Icon name="undo" className="size-5" />
                </Button>
                <Button size="xs" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} title="Play / pause (Space)">
                  <Icon name={playing ? "pause" : "play"} className="size-5" />
                </Button>
                <span className="px-1 font-mono text-meta text-ink-muted tabular-nums">
                  {formatTime(playhead, true)} / {formatTime(total, true)}
                </span>
                <Button size="xs" variant="ghost" onClick={doSplit} title="Split at playhead (S)">
                  <Icon name="scissors" className="size-5" /> Split
                </Button>
              </div>
              <ul className="flex flex-wrap gap-x-3 text-meta text-ink-muted" aria-label="Layers">
                {layers.map((l) => (
                  <li key={l.label}>
                    {l.label} <span className="font-medium text-ink tabular-nums">{l.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {showAgent && (
            <>
              <ResizeHandle
                axis="x"
                label="Resize agent panel"
                className="hidden lg:block"
                onResize={(d) => setAgentWidth((w) => clamp(w - d, AGENT_MIN, AGENT_MAX))}
                onDoubleClick={() => setAgentWidth(AGENT_DEFAULT)}
              />
              <aside
                className="order-3 flex max-h-[80vh] min-h-96 flex-col overflow-hidden rounded-lg border border-line bg-surface lg:order-none lg:max-h-none lg:min-h-0 lg:w-(--agent) lg:shrink-0"
                style={{ "--agent": `${clamp(agentWidth, AGENT_MIN, AGENT_MAX)}px` } as React.CSSProperties}
              >
                <AgentPanel
                  projectId={projectId}
                  messages={project.chat}
                  version={project.version}
                  busy={chatBusy}
                  error={chatError}
                  onSend={sendChat}
                  onRestore={restoreVersion}
                />
              </aside>
            </>
          )}
        </div>

        <ResizeHandle
          axis="y"
          label="Resize timeline"
          className="hidden lg:block"
          onResize={(d) => setTimelineHeight((h) => clamp(h - d, TIMELINE_MIN, TIMELINE_MAX))}
          onDoubleClick={() => setTimelineHeight(TIMELINE_DEFAULT)}
        />

        {/* Timeline */}
        <section
          className="mt-3 flex min-h-0 flex-col gap-1 lg:mt-0 lg:h-(--timeline) lg:shrink-0"
          style={{ "--timeline": `${clamp(timelineHeight, TIMELINE_MIN, TIMELINE_MAX)}px` } as React.CSSProperties}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-meta text-ink-muted">
              Drag to move · drag edges to trim · drop media on a track · <kbd>S</kbd> split · <kbd>Del</kbd> delete · <kbd>Space</kbd> play · <kbd>Ctrl+Z</kbd> undo
            </p>
            <div className="flex items-center">
              <Button size="xs" variant="ghost" onClick={() => setPxPerSec((z) => Math.max(4, z / 1.5))} aria-label="Zoom out" title="Zoom out">
                <Icon name="zoomOut" className="size-5" />
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setPxPerSec((z) => Math.min(300, z * 1.5))} aria-label="Zoom in" title="Zoom in">
                <Icon name="zoomIn" className="size-5" />
              </Button>
            </div>
          </div>
          <Timeline
            className="min-h-0 flex-1"
            timeline={timeline}
            playhead={playhead}
            selectedId={selectedId}
            pxPerSec={pxPerSec}
            onSelect={(itemId) => {
              setSelectedId(itemId);
              if (itemId) {
                setLibraryTab("properties");
                setShowLibrary(true);
              }
            }}
            onSeek={seek}
            onPreview={(next) => {
              setTimeline(next);
              timelineRef.current = next;
            }}
            onCommit={(next, before) => apply(next, { before })}
            onDropAsset={doDropAsset}
          />
        </section>
      </div>
    </div>
  );
}

/** A slim, dismissable message line (the full-size Notice is too tall for a working screen). */
function Strip({ tone, onDismiss, children }: { tone: "success" | "danger"; onDismiss(): void; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-between gap-3 rounded-md px-4 py-1 text-base",
        tone === "success" ? "bg-success-subtle text-success" : "bg-danger-subtle text-danger",
      )}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">{children}</span>
      <Button size="xs" variant="ghost" onClick={onDismiss} aria-label="Dismiss">
        <Icon name="x" className="size-5" />
      </Button>
    </div>
  );
}

function SaveBadge({ state, version, onReload }: { state: SaveState; version: number; onReload(): void }) {
  if (state === "conflict") {
    return (
      <Button size="xs" variant="danger" onClick={onReload}>
        Changed elsewhere · Reload
      </Button>
    );
  }
  const label = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved", error: "Not saved" }[state];
  return (
    <Badge tone={state === "error" ? "danger" : state === "saved" ? "success" : "neutral"}>
      {label} · v{version}
    </Badge>
  );
}
