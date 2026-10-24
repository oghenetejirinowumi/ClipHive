"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/** The Studio is part of the Editor now: a video's moments live in the editor's Moments tab. */
export default function StudioProjectPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  useEffect(() => {
    router.replace(`/editor/open?import=${id}`);
  }, [id, router]);
  return <p className="text-lg text-ink-muted">Opening the editor…</p>;
}
