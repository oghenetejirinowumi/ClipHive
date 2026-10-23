import { Badge } from "./Badge";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger";

// Backend ClipStatus + PostStatus (app/models/enums.py). Status colours describe state only.
const STATES: Record<string, { tone: Tone; label: string }> = {
  processing: { tone: "warning", label: "Processing" },
  captioning: { tone: "brand", label: "Captioning" },
  ready: { tone: "success", label: "Ready" },
  failed: { tone: "danger", label: "Failed" },
  queued: { tone: "neutral", label: "Queued" },
  posting: { tone: "brand", label: "Posting" },
  posted: { tone: "success", label: "Posted" },
};

/** Status pill with a dot; the dot is never the only signal, the label always shows. */
export function StatusBadge({ status, size = "sm" }: { status: string; size?: "sm" | "md" }) {
  const state = STATES[status] ?? { tone: "neutral" as const, label: status };
  return (
    <Badge tone={state.tone} size={size}>
      <span aria-hidden className="size-2.5 rounded-full bg-current" />
      {state.label}
    </Badge>
  );
}
