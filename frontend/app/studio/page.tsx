"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

/** The Studio is part of the Editor now. Old links (`/studio?clip=ID`) still land in the right place. */
function StudioRedirect() {
  const router = useRouter();
  const clip = useSearchParams().get("clip");
  useEffect(() => {
    router.replace(clip ? `/editor/open?clip=${clip}` : "/editor");
  }, [clip, router]);
  return <p className="text-lg text-ink-muted">Opening the editor…</p>;
}

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioRedirect />
    </Suspense>
  );
}
