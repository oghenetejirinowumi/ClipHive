"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, buttonClass, Em, Icon, Notice, Panel, SectionLabel, SkyHeader, StatusBadge } from "@/components/ui";
import { api, API_URL } from "@/lib/api";

type Clip = {
  id: number;
  title?: string | null;
  file_path?: string | null;
  raw_file_path?: string | null;
  duration_s: number;
  highlight_score?: number | null;
  hashtags?: string[];
  status: string;
  created_at: string;
};

export default function HubPage() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [postingClipId, setPostingClipId] = useState<number | null>(null);
  const [postMessage, setPostMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadClips() {
      try {
        const data = await api<Clip[]>("/api/clips", { auth: false });
        setClips(data);
      } catch (err) {
        console.warn("Could not load clips:", err);
      }
    }
    loadClips();
  }, []);

  function handleSimulatePost(clipId: number, platform: string) {
    setPostingClipId(clipId);
    setPostMessage(`Queueing Clip #${clipId} to ${platform}...`);
    setTimeout(() => {
      setPostMessage(`Successfully dispatched to ${platform} queue! (ID: pub_${Date.now().toString().slice(-6)})`);
      setPostingClipId(null);
    }, 1200);
  }

  const ready = clips.filter((c) => c.status === "ready").length;

  return (
    <div className="space-y-12">
      <SkyHeader
        eyebrow="Distribution hub"
        title={
          <>
            Ready to <Em>post</Em>
          </>
        }
        description="Browse viral 9:16 shorts with burned captions. Download in one tap, or dispatch to TikTok and YouTube."
      />

      {postMessage && (
        <Notice tone={postMessage.startsWith("Successfully") ? "success" : "brand"} onDismiss={() => setPostMessage(null)}>
          {postMessage}
        </Notice>
      )}

      {clips.length > 0 && (
        <div className="flex flex-wrap items-center gap-4">
          <SectionLabel>Your clips</SectionLabel>
          <Badge tone="neutral" size="md">
            {clips.length} total · {ready} ready
          </Badge>
        </div>
      )}

      <div className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
        {clips.map((clip) => {
          const videoSrc = clip.file_path ? `${API_URL}/${clip.file_path}` : `${API_URL}/storage/clips/clip_1_punch.mp4`;

          return (
            <Panel key={clip.id} as="article" padding="none" className="flex flex-col overflow-hidden">
              {/* 9:16 video: always dark, it stands in for the feed */}
              <div className="relative aspect-[9/16] w-full bg-brand-deep">
                <video src={videoSrc} controls playsInline preload="metadata" className="size-full object-cover" />
                {clip.highlight_score ? (
                  <span className="absolute top-4 left-4 rounded-full bg-brand-deep/80 px-3 py-1 text-meta font-semibold text-on-brand tabular-nums">
                    Hook {Math.round(clip.highlight_score)}/100
                  </span>
                ) : null}
              </div>

              <div className="flex flex-1 flex-col gap-6 p-7">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-meta tracking-[0.12em] text-ink-muted uppercase">Clip #{clip.id}</span>
                  <StatusBadge status={clip.status} />
                </div>

                <div className="flex-1">
                  <h3 className="font-display text-2xl leading-snug font-semibold tracking-tight text-ink">{clip.title || "Untitled viral highlight"}</h3>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {clip.hashtags && clip.hashtags.length > 0 ? (
                      clip.hashtags.map((tag, idx) => (
                        <Badge key={idx} tone="brand">
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-base text-ink-faint">No hashtags attached</span>
                    )}
                  </div>
                </div>

                <Link href={`/studio?clip=${clip.id}`} className={buttonClass({ variant: "ghost", size: "sm", className: "justify-start px-0" })}>
                  <Icon name="film" className="size-5" /> Edit in studio
                </Link>

                {/* Download always works, even when a platform's quota is spent. */}
                <div className="grid grid-cols-2 gap-3 border-t border-line pt-6">
                  <a href={videoSrc} download={`clip_${clip.id}_final.mp4`} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}>
                    <Icon name="download" className="size-5" />
                    Download
                  </a>
                  <Button size="sm" loading={postingClipId === clip.id} onClick={() => handleSimulatePost(clip.id, "TikTok & Shorts")}>
                    <Icon name="play" className="size-5" />
                    Post
                  </Button>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      {clips.length === 0 && (
        <Panel tone="sunken" padding="lg" className="flex flex-col items-center py-16 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-brand-subtle text-brand-strong">
            <Icon name="grid" />
          </span>
          <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">No clips ready yet</p>
          <p className="mt-2 max-w-xl text-lg text-ink-muted">Create or burn clips in the Caption Studio to see them appear here in the Hub.</p>
          <Button href="/captions" className="mt-8">
            Open Caption Studio <Icon name="arrowRight" className="size-5" />
          </Button>
        </Panel>
      )}
    </div>
  );
}
