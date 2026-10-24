"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaptionPreview, type PreviewWord } from "@/components/captions/CaptionPreview";
import { PhoneFrame } from "@/components/captions/PhoneFrame";
import { StyleEditor } from "@/components/captions/StyleEditor";
import { Badge, Button, Em, Field, Icon, Notice, Panel, SectionLabel, Segmented, Select, SkyHeader, StatusBadge } from "@/components/ui";
import { api, API_URL, ApiError, apiUrl } from "@/lib/api";
import { ANIMATION_LABEL, draftOf, stylePayload, type CaptionStyle, type PreviewEmoji, type StyleDraft } from "@/lib/captions";
import { cn } from "@/lib/cn";

type Clip = {
  id: number;
  title?: string | null;
  file_path?: string | null;
  status: string;
  caption_style_id?: number | null;
  context_json?: { suggested_style?: string; style_rationale?: string } | null;
};

type Msg = { tone: "brand" | "success" | "danger"; text: string };

const HYPE = new Set(["INSANE", "CLUTCH", "NO", "WAY", "OMG", "ACE", "WHAT"]);
const DEFAULT_TEXT = "Bro you CANNOT miss that shot, that was INSANE";

const toWords = (text: string): PreviewWord[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 24)
    .map((word) => ({ word, hype: HYPE.has(word.toUpperCase().replace(/[!?,.]/g, "")) }));

const same = (a: StyleDraft | null, b: StyleDraft | null) => JSON.stringify(a && stylePayload(a)) === JSON.stringify(b && stylePayload(b));

export default function CaptionsPage() {
  const [styles, setStyles] = useState<CaptionStyle[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [category, setCategory] = useState("All");
  const [draft, setDraft] = useState<StyleDraft | null>(null); // editing when set
  const [saved, setSaved] = useState<StyleDraft | null>(null); // the draft as last saved
  const [sampleText, setSampleText] = useState(DEFAULT_TEXT);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [view, setView] = useState<"live" | "exact">("live");
  const [exactUrl, setExactUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [clipId, setClipId] = useState<number | null>(null);
  const [burning, setBurning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const loadStyles = useCallback(async (select?: number) => {
    const data = await api<CaptionStyle[]>("/api/styles", { auth: false });
    setStyles(data);
    setSelectedId((cur) => select ?? cur ?? data[0]?.id ?? null);
    return data;
  }, []);

  useEffect(() => {
    loadStyles().catch(() => setMsg({ tone: "danger", text: "Couldn't load caption styles. Is the backend running?" }));
    api<Clip[]>("/api/clips", { auth: false })
      .then((c) => {
        setClips(c);
        setClipId(c[0]?.id ?? null);
      })
      .catch(() => undefined);
  }, [loadStyles]);

  // Fonts for presets download in the background on first load; refresh once so previews pick them up.
  const missingFonts = styles.some((s) => !s.font_available);
  useEffect(() => {
    if (!missingFonts) return;
    const t = setTimeout(() => loadStyles().catch(() => undefined), 4000);
    return () => clearTimeout(t);
  }, [missingFonts, loadStyles]);

  const words = useMemo(() => toWords(sampleText), [sampleText]);
  useEffect(() => {
    if (!playing || words.length === 0) return;
    const t = setInterval(() => setActive((i) => (i + 1) % words.length), 420);
    return () => clearInterval(t);
  }, [playing, words.length]);

  const selected = styles.find((s) => s.id === selectedId) ?? styles[0];
  const previewStyle: StyleDraft | null = draft ?? (selected ? draftOf(selected) : null);
  const dirty = draft !== null && !same(draft, saved);

  // Which sample words get an emoji (the backend's rules, so the preview matches the burn).
  const [emojis, setEmojis] = useState<PreviewEmoji[]>([]);
  const po = previewStyle?.options;
  const emojiOn = !!po?.emojis;
  const perGroup = previewStyle?.animation_type === "single_word" ? 1 : (po?.words_per_line ?? 3) * (po?.max_lines ?? 2);
  const emojiKey = emojiOn ? JSON.stringify([sampleText, perGroup, po?.emoji_amount, po?.emoji_motion, po?.emoji_placement]) : "";
  useEffect(() => {
    if (!emojiKey) {
      setEmojis([]);
      return;
    }
    const [text, words_per_group, amount, motion, placement] = JSON.parse(emojiKey);
    const t = setTimeout(() => {
      api<PreviewEmoji[]>("/api/styles/emoji-plan", { method: "POST", body: { text, words_per_group, word_s: 0.42, amount, motion, placement } })
        .then(setEmojis)
        .catch(() => setEmojis([]));
    }, 250);
    return () => clearTimeout(t);
  }, [emojiKey]);

  // Any edit makes the exact render stale.
  const previewKey = JSON.stringify(previewStyle && stylePayload(previewStyle)) + sampleText;
  useEffect(() => {
    setExactUrl(null);
    setView("live");
  }, [previewKey]);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(styles.map((s) => (s.is_preset ? s.category : "Yours") ?? "Other")));
    return ["All", ...cats.filter((c) => c !== "Yours"), ...(cats.includes("Yours") ? ["Yours"] : [])];
  }, [styles]);
  const shown = styles.filter((s) => category === "All" || (s.is_preset ? s.category : "Yours") === category);

  function startEditing(style: CaptionStyle) {
    const d = draftOf(style);
    setDraft(d);
    setSaved(d);
  }

  async function customise() {
    if (!selected) return;
    if (!selected.is_preset) return startEditing(selected);
    setBusy("customise");
    try {
      const copy = await api<CaptionStyle>(`/api/styles/${selected.id}/duplicate`, { method: "POST", auth: false });
      await loadStyles(copy.id);
      startEditing(copy);
      setMsg({ tone: "brand", text: `Made “${copy.name}” from the ${selected.name} preset. Change anything, then save.` });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Couldn't copy that style." });
    } finally {
      setBusy(null);
    }
  }

  async function save(asNew = false) {
    if (!draft) return;
    setBusy("save");
    try {
      const body = stylePayload({ ...draft, name: asNew ? `${draft.name} copy`.slice(0, 100) : draft.name });
      const result =
        draft.id && !asNew
          ? await api<CaptionStyle>(`/api/styles/${draft.id}`, { method: "PATCH", body, auth: false })
          : await api<CaptionStyle>("/api/styles", { method: "POST", body, auth: false });
      await loadStyles(result.id);
      startEditing(result);
      setMsg({ tone: "success", text: `Saved “${result.name}”.` });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Couldn't save." });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!draft?.id || !window.confirm(`Delete “${draft.name}”? Clips already burned keep their captions.`)) return;
    setBusy("delete");
    try {
      await api(`/api/styles/${draft.id}`, { method: "DELETE", auth: false });
      setDraft(null);
      setSaved(null);
      const data = await loadStyles();
      setSelectedId(data[0]?.id ?? null);
      setMsg({ tone: "brand", text: "Style deleted." });
    } finally {
      setBusy(null);
    }
  }

  async function importAss(file: File) {
    setBusy("import");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(apiUrl("/api/styles/import-ass"), { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Import failed");
      const created = data as CaptionStyle[];
      await loadStyles(created[0]?.id);
      setCategory("Yours");
      const missing = created.filter((s) => !s.font_available).map((s) => s.font_name);
      setMsg({
        tone: "success",
        text:
          `Imported ${created.length} style${created.length === 1 ? "" : "s"} from ${file.name}.` +
          (missing.length ? ` Font not found: ${Array.from(new Set(missing)).join(", ")}; upload it in the editor.` : ""),
      });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof Error ? err.message : "Import failed." });
    } finally {
      setBusy(null);
      if (importInput.current) importInput.current.value = "";
    }
  }

  async function renderExact() {
    if (!previewStyle) return;
    setRendering(true);
    try {
      const res = await api<{ url: string; font_found: boolean }>("/api/styles/render-preview", {
        method: "POST",
        body: { style: stylePayload(previewStyle), text: sampleText, clip_id: clipId },
        auth: false,
      });
      setExactUrl(`${API_URL}/${res.url}`);
      setView("exact");
      if (!res.font_found) setMsg({ tone: "danger", text: `The font “${previewStyle.font_name}” isn't installed, so the video used a fallback. Pick or upload it in the editor.` });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Couldn't render the preview." });
    } finally {
      setRendering(false);
    }
  }

  function updatePosition(pos: number) {
    if (!previewStyle) return;
    if (!draft) {
      const base = draftOf(selected);
      const d: StyleDraft = {
        ...base,
        id: selected.is_preset ? undefined : selected.id,
        name: selected.is_preset ? `${selected.name} (my version)` : selected.name,
        is_preset: false,
        options: { ...base.options, position_y: pos },
      };
      setDraft(d);
      setSaved(selected.is_preset ? null : base);
    } else {
      setDraft((cur) => cur && { ...cur, options: { ...cur.options, position_y: pos } });
    }
  }

  async function burn() {
    const styleId = draft?.id ?? selected?.id;
    if (!clipId || !styleId) return;
    setBurning(true);
    setMsg({ tone: "brand", text: "Transcribing and burning captions…" });
    try {
      const updated = await api<Clip>(`/api/clips/${clipId}/regenerate-captions`, {
        method: "POST",
        body: {
          style_id: styleId,
          caption_mode: "burned",
          position_y: previewStyle?.options.position_y,
        },
        auth: false,
      });
      setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setExactUrl(updated.file_path ? `${API_URL}/${updated.file_path}` : null);
      setView("exact");
      setMsg({ tone: "success", text: `Captions burned into clip #${updated.id}. It's playing on the right.` });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Burning failed." });
    } finally {
      setBurning(false);
    }
  }

  const activeClip = clips.find((c) => c.id === clipId);
  const suggested = activeClip?.context_json?.suggested_style;
  const suggestedStyle = suggested ? styles.find((s) => s.name.toLowerCase() === suggested.toLowerCase()) : undefined;

  return (
    <div className="space-y-12">
      <SkyHeader
        eyebrow="Caption studio"
        title={
          <>
            Captions with <Em>personality</Em>
          </>
        }
        description="Start from a proven short-form look, tune every detail, and see exactly what the video will show before you burn it."
      />

      {msg && (
        <Notice tone={msg.tone} onDismiss={() => setMsg(null)}>
          {msg.text}
        </Notice>
      )}

      <div className="grid gap-10 lg:grid-cols-12">
        {/* Left: library or editor */}
        <div className="space-y-8 lg:col-span-7">
          {draft ? (
            <Panel padding="lg" className="space-y-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={() => (dirty && !window.confirm("Discard unsaved changes?") ? null : (setDraft(null), setSaved(null)))}>
                    <Icon name="arrowRight" className="size-5 rotate-180" /> Library
                  </Button>
                  {dirty ? <Badge tone="warning">Unsaved</Badge> : <Badge tone="success">Saved</Badge>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {dirty && (
                    <Button variant="ghost" size="sm" onClick={() => setDraft(saved)}>
                      Undo changes
                    </Button>
                  )}
                  {draft.id && (
                    <Button variant="ghost" size="sm" loading={busy === "delete"} onClick={remove}>
                      Delete
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" loading={busy === "save"} onClick={() => save(true)}>
                    Save as new
                  </Button>
                  <Button size="sm" loading={busy === "save"} disabled={!dirty} onClick={() => save(false)}>
                    <Icon name="check" className="size-5" /> Save
                  </Button>
                </div>
              </div>
              <StyleEditor draft={draft} onChange={setDraft} />
            </Panel>
          ) : (
            <section className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <SectionLabel>Style library</SectionLabel>
                  <Badge tone="brand">{styles.length} styles</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" loading={busy === "import"} onClick={() => importInput.current?.click()}>
                    <Icon name="upload" className="size-5" /> Import .ass
                  </Button>
                  <input ref={importInput} type="file" accept=".ass,.ssa" className="sr-only" onChange={(e) => e.target.files?.[0] && importAss(e.target.files[0])} />
                  <Button size="sm" loading={busy === "customise"} disabled={!selected} onClick={customise}>
                    <Icon name="sparkles" className="size-5" /> {selected?.is_preset ? "Customise this style" : "Edit this style"}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={category === c}
                    onClick={() => setCategory(c)}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-full border px-4 text-base font-medium transition-colors duration-(--motion-fast)",
                      category === c ? "border-brand bg-brand text-on-brand" : "border-line-strong text-ink-muted hover:border-brand hover:text-ink",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                {shown.map((style) => {
                  const isSel = style.id === selected?.id;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      aria-pressed={isSel}
                      onClick={() => setSelectedId(style.id)}
                      onDoubleClick={customise}
                      className={cn("tactile overflow-hidden rounded-lg border text-left", isSel ? "border-brand bg-brand-subtle shadow-glow-strong" : "border-line bg-surface shadow-glow")}
                    >
                      <div className="@container relative grid h-40 place-items-center overflow-hidden bg-brand-deep px-4">
                        <CaptionPreview
                          style={{ ...draftOf(style), options: { ...style.options, words_per_line: 3, max_lines: 1 } }}
                          words={toWords("No way that was")}
                          activeIndex={1}
                          zoom={2.2}
                        />
                      </div>
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-display text-xl font-semibold tracking-tight text-ink">{style.name}</span>
                          <Badge tone={isSel ? "brand" : "neutral"} size="sm" className="shrink-0 whitespace-nowrap">
                            {ANIMATION_LABEL[style.animation_type] ?? style.animation_type}
                          </Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-base text-ink-muted">{style.description || `${style.font_name} · ${style.font_size}px`}</p>
                        {!style.font_available && <p className="mt-2 text-meta text-ink-faint">Downloading font…</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Burn */}
          <Panel padding="lg" className="space-y-6">
            <div>
              <SectionLabel>Render</SectionLabel>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink">Burn onto a clip</h2>
              <p className="mt-2 text-lg text-ink-muted">
                Uses <span className="font-semibold text-ink">{(draft ?? selected)?.name ?? "the selected style"}</span>
                {dirty ? " as last saved. Save your changes first to use them." : "."}
              </p>
            </div>
            {clips.length > 0 ? (
              <Field label="Clip">
                <Select value={clipId ?? ""} onChange={(e) => setClipId(Number(e.target.value))}>
                  {clips.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.id} — {c.title || "Untitled"} ({c.status})
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <p className="text-lg text-ink-muted">No clips yet. Make some on the Create page.</p>
            )}
            {activeClip && (
              <div className="flex flex-wrap items-center gap-3 text-base text-ink-muted">
                Status <StatusBadge status={activeClip.status} />
                {suggestedStyle && (
                  <>
                    <span>· The agent suggests {suggestedStyle.name}</span>
                    {!draft && suggestedStyle.id !== selected?.id && (
                      <Button variant="ghost" size="sm" onClick={() => setSelectedId(suggestedStyle.id)}>
                        Use it
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
            <Button size="lg" loading={burning} disabled={!clipId || dirty} onClick={burn}>
              <Icon name="captions" /> Burn captions
            </Button>
          </Panel>
        </div>

        {/* Right: preview */}
        <div className="lg:col-span-5">
          <div className="space-y-5 lg:sticky lg:top-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionLabel>9:16 preview</SectionLabel>
              <Segmented
                label="Preview"
                value={view}
                onChange={(v) => (v === "exact" && !exactUrl ? renderExact() : setView(v))}
                options={[
                  { value: "live", label: "Live" },
                  { value: "exact", label: "Exact render" },
                ]}
              />
            </div>

            <PhoneFrame>
              {view === "exact" && exactUrl ? (
                <video key={exactUrl} src={exactUrl} autoPlay loop muted playsInline controls className="size-full object-cover" />
              ) : (
                <div
                  className="@container relative size-full cursor-ns-resize"
                  onPointerDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const update = (clientY: number) => {
                      const pct = Math.max(12, Math.min(86, Math.round(((clientY - rect.top) / rect.height) * 100)));
                      updatePosition(pct);
                    };
                    update(e.clientY);
                    const move = (ev: PointerEvent) => update(ev.clientY);
                    const up = () => {
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", up);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                  }}
                >
                  <CaptionPreview style={previewStyle ?? undefined} words={words} activeIndex={active} emojis={emojis} frame />
                  <div aria-hidden className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-brand-deep/80 px-2.5 py-0.5 text-meta text-on-brand/60">
                    drag up / down to move
                  </div>
                  {rendering && (
                    <div className="absolute inset-x-0 top-10 flex justify-center">
                      <span className="rounded-full bg-brand-deep/85 px-4 py-2 text-meta font-semibold text-on-brand">Rendering exactly…</span>
                    </div>
                  )}
                </div>
              )}
            </PhoneFrame>

            {/* Quick Caption Position Selector */}
            <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-sunken p-2.5">
              <div className="flex items-center gap-1.5">
                <Icon name="captions" className="size-5 text-brand" />
                <span className="text-meta font-medium text-ink">Position:</span>
                <span className="font-mono text-meta font-semibold text-brand-strong">{previewStyle?.options.position_y ?? 68}%</span>
              </div>
              <div className="flex items-center gap-1">
                {[
                  { label: "Top", pos: 20 },
                  { label: "Center", pos: 50 },
                  { label: "Bottom", pos: 68 },
                ].map((p) => (
                  <button
                    key={p.pos}
                    type="button"
                    onClick={() => updatePosition(p.pos)}
                    className={`rounded px-2.5 py-1 text-meta font-semibold transition-colors ${
                      (previewStyle?.options.position_y ?? 68) === p.pos
                        ? "bg-brand text-on-brand shadow-sm"
                        : "border border-line bg-surface text-ink-muted hover:text-ink"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label htmlFor="sample-text" className="block text-base font-medium text-ink">
                Sample text
              </label>
              <div className="flex gap-2">
                <input
                  id="sample-text"
                  value={sampleText}
                  maxLength={200}
                  onChange={(e) => {
                    setSampleText(e.target.value);
                    setActive(0);
                  }}
                  className="block h-12 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-4 text-base text-ink focus:border-brand focus:shadow-ring focus-visible:outline-none"
                />
                <Button variant="secondary" size="sm" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
                  <Icon name={playing ? "pause" : "play"} className="size-5" />
                </Button>
              </div>
              <p className="text-meta text-ink-muted">Words in CAPS like NO, WAY or INSANE count as hype words. “Exact render” burns this text with the real video engine{clipId ? " over your selected clip" : ""}.</p>
              <Button variant="secondary" loading={rendering} onClick={renderExact} className="w-full">
                <Icon name="film" className="size-5" /> Render exactly
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
