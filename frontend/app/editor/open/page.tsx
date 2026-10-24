"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { buttonClass, Panel } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Project } from "@/lib/editor";

// One request per clip or video, however often this page mounts (React runs effects twice in
// development, and a double click opens it twice): otherwise each mount started its own edit.
const opening = new Map<string, Promise<Project>>();

type OpenBody = ({ clip_id: number } | { import_id: number }) & { title?: string; aspect?: string };

function openOnce(body: OpenBody): Promise<Project> {
  const key = JSON.stringify(body);
  let request = opening.get(key);
  if (!request) {
    request = api<Project>("/api/editor/open", { method: "POST", body });
    opening.set(key, request);
    request.finally(() => setTimeout(() => opening.delete(key), 2000)).catch(() => {});
  }
  return request;
}

/**
 * /editor/open?clip=12 or ?import=3: "Edit" anywhere in the app lands here. It reopens the edit
 * made from that clip or video before (or starts one) and moves on to the editor.
 */
function OpenInEditor() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const clip = params.get("clip");
  const video = params.get("import");
  const title = params.get("title") ?? undefined; // from the New edit form; used only for a new edit
  const aspect = params.get("aspect") ?? undefined;

  useEffect(() => {
    const source = clip ? { clip_id: Number(clip) } : video ? { import_id: Number(video) } : null;
    const body: OpenBody | null = source && { ...source, ...(title ? { title } : {}), ...(aspect ? { aspect } : {}) };
    if (!body) {
      router.replace("/editor");
      return;
    }
    let cancelled = false;
    openOnce(body)
      .then((p) => !cancelled && router.replace(`/editor/${p.id}`))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't open that in the editor."));
    return () => {
      cancelled = true;
    };
  }, [clip, video, title, aspect, router]);

  if (error) {
    return (
      <Panel padding="lg" className="space-y-4">
        <p className="text-lg text-danger">{error}</p>
        <Link href="/editor" className={buttonClass({ variant: "secondary" })}>
          Go to the editor
        </Link>
      </Panel>
    );
  }
  return <p className="text-lg text-ink-muted">Opening the editor…</p>;
}

export default function OpenInEditorPage() {
  return (
    <Suspense fallback={<p className="text-lg text-ink-muted">Opening the editor…</p>}>
      <OpenInEditor />
    </Suspense>
  );
}
