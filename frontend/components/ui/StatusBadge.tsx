import { Badge } from "./Badge";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger";

// Backend ClipStatus + PostStatus (app/models/enums.py). Status colours describe state only.
const STATES: Record<string, { tone: Tone; label: string }> = {
  processing: { tone: "warning", label: "Processing" },
  captioning: { tone: "brand", label: "Captioning" },
  ready: { tone: "success", label: "Ready" },
  failed: { tone: "danger", label: "Failed" },
  queued: { tone: "neutral", label: "Scheduled" },
  pending: { tone: "warning", label: "Needs review" },
  approved: { tone: "success", label: "Approved" },
  rejected: { tone: "neutral", label: "Rejected" },
  running: { tone: "brand", label: "Working" },
  done: { tone: "success", label: "Done" },
  posting: { tone: "brand", label: "Posting" },
  posted: { tone: "success", label: "Posted" },
};

/** Status pill with a dot; the dot is never the only signal, the label always shows. */
export function StatusBadge({ status, label, size = "sm" }: { status: string; label?: string; size?: "sm" | "md" }) {
  const found = STATES[status] ?? { tone: "neutral" as const, label: status };
  const state = label ? { ...found, label } : found;
  return (
    <Badge tone={state.tone} size={size}>
      <span aria-hidden className="size-2.5 rounded-full bg-current" />
      {state.label}
    </Badge>
  );
}
