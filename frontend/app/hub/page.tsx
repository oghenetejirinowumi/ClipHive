"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Icon, PageHeader, Panel } from "@/components/ui";
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

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Distribution Hub"
        title="Ready-to-Post Clips"
        description="Browse viral 9:16 shorts with burned captions. Download in one tap, or dispatch to TikTok and YouTube."
      />

      {postMessage && (
        <Panel tone="brand" padding="sm" className="flex items-center justify-between">
          <span className="text-base font-semibold text-brand-strong">{postMessage}</span>
          <Button variant="ghost" size="sm" onClick={() => setPostMessage(null)}>
            Dismiss
          </Button>
        </Panel>
      )}

      {/* Grid of Ready Clips */}
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {clips.map((clip) => {
          const videoSrc = clip.file_path
            ? `${API_URL}/${clip.file_path}`
            : `${API_URL}/storage/clips/clip_1_punch.mp4`;

          return (
            <Panel key={clip.id} padding="none" className="flex flex-col overflow-hidden">
              {/* 9:16 Video Canvas */}
              <div className="relative aspect-[9/16] w-full bg-ink">
                <video
                  src={videoSrc}
                  controls
                  playsInline
                  preload="metadata"
                  className="size-full object-cover"
                />
                {clip.highlight_score && (
                  <div className="absolute top-4 right-4">
                    <Badge tone="success" size="sm">
                      {Math.round(clip.highlight_score)}/100 Hook
                    </Badge>
                  </div>
                )}
              </div>

              {/* Clip Metadata & Actions */}
              <div className="flex flex-1 flex-col justify-between p-6 space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-meta font-medium text-ink-faint">Clip #{clip.id}</span>
                    <Badge tone={clip.status === "ready" ? "brand" : "warning"} size="sm">
                      {clip.status.toUpperCase()}
                    </Badge>
                  </div>

                  <h3 className="mt-2 font-display text-xl font-bold text-ink">
                    {clip.title || "Untitled Viral Highlight"}
                  </h3>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {clip.hashtags && clip.hashtags.length > 0 ? (
                      clip.hashtags.map((tag, idx) => (
                        <Badge key={idx} tone="neutral" size="sm">
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-meta text-ink-faint">No hashtags attached</span>
                    )}
                  </div>
                </div>

                {/* Primary Action Buttons: Download + Post */}
                <div className="space-y-2 pt-2 border-t border-line">
                  <div className="flex items-center gap-2">
                    <a
                      href={videoSrc}
                      download={`clip_${clip.id}_final.mp4`}
                      className="flex-1"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="secondary" size="sm" className="w-full">
                        <Icon name="arrowRight" className="size-5 rotate-90" />
                        Download MP4
                      </Button>
                    </a>

                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      loading={postingClipId === clip.id}
                      onClick={() => handleSimulatePost(clip.id, "TikTok & Shorts")}
                    >
                      <Icon name="play" className="size-5" />
                      Post Clip
                    </Button>
                  </div>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      {clips.length === 0 && (
        <Panel tone="sunken" className="text-center py-12">
          <p className="text-lg font-medium text-ink-muted">No clips ready yet.</p>
          <p className="mt-2 text-base text-ink-faint">
            Create or burn clips in the Caption Studio to see them appear here in the Hub.
          </p>
        </Panel>
      )}
    </div>
  );
}
