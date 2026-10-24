"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * A channel's real profile picture, pulled from Twitch / Kick / YouTube by the backend.
 * Falls back to the channel's initial when there's no picture or it fails to load.
 *
 * - `live`: green ring and a LIVE tag.
 * - `busy`: a spinning ring while the channel is being checked.
 * - `recording`: a pulsing red ring.
 * - `paused`: greyed out.
 * Decorative (aria-hidden); the state is always also written in text next to it.
 */
export function ChannelAvatar({
  src,
  name,
  size = 56,
  live,
  busy,
  recording,
  paused,
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  live?: boolean;
  busy?: boolean;
  recording?: boolean;
  paused?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!src && failed !== src;

  return (
    <span
      aria-hidden
      className={cn(
        "channel-avatar",
        live && !paused && "channel-avatar-live",
        recording && "channel-avatar-recording",
        busy && "channel-avatar-busy",
        paused && "channel-avatar-paused",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span className="channel-avatar-face">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatars come from the platforms' own image hosts
          <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" onError={() => setFailed(src)} />
        ) : (
          <span className="font-display font-bold" style={{ fontSize: size * 0.4 }}>
            {name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      {live && !paused && <span className="channel-avatar-tag">Live</span>}
    </span>
  );
}
