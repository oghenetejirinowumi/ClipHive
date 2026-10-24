"use client";

import { useEffect, useRef, useState } from "react";
import { pausedAttr, useInView, useMotionBudget } from "@/components/effects/useMotion";
import { cn, cssVars } from "@/lib/cn";
import { Bee, type BeeVariant } from "./Bee";

type Agent = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  retarget: number;
  speed: number;
  phase: number;
  facing: 1 | -1;
};

type Mark = { id: number; x: number; y: number };

const VARIANTS: BeeVariant[] = ["scout", "worker", "honey", "plain", "worker", "scout", "plain", "honey", "plain"];
// Deterministic sizes so the server render and the first client render agree.
const SIZES = [42, 32, 38, 30, 36, 30, 40, 28, 34];

/**
 * Bees flying around their parent. Fill a `relative isolate overflow-hidden` parent with it.
 *
 * - Each bee wanders between random points, banks into its turns and faces where it flies.
 * - `interactive`: a tap or click inside the swarm's area (listened for on the nearest
 *   `[data-swarm-host]`, else the parent) calls the swarm to that spot, where they
 *   circle it and leave a figure-eight waggle-dance mark (the dance bees use to say "food here").
 *   Uses `click`, so scrolling a phone never summons them; only a real tap does.
 * - On a mouse, the lead bee is curious and drifts after the pointer.
 * - Phones and low-end devices get half the bees; reduced motion gets a few resting bees and
 *   no animation loop. The loop stops while the swarm is offscreen or the tab is hidden.
 */
export function BeeSwarm({
  count = 6,
  tone = "default",
  interactive = false,
  pollen = false,
  className,
}: {
  count?: number;
  tone?: "default" | "inverse";
  interactive?: boolean;
  /** Slow rising specks behind the bees. */
  pollen?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const beeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  // Kept across pauses so bees carry on from where they were when scrolled back into view.
  const agentsRef = useRef<Agent[]>([]);
  const budget = useMotionBudget();
  const inView = useInView(ref, { rootMargin: "120px" });
  const [marks, setMarks] = useState<Mark[]>([]);
  const n = budget === "off" ? Math.min(3, count) : budget === "lite" ? Math.max(2, Math.ceil(count / 2)) : count;

  useEffect(() => {
    const box = ref.current;
    if (!box || budget === "off" || !inView) return;
    // Taps are caught on the nearest [data-swarm-host] (the swarm itself ignores the pointer).
    const host = box.closest<HTMLElement>("[data-swarm-host]") ?? box.parentElement;
    let w = box.clientWidth;
    let h = box.clientHeight;
    const pad = 24;
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    const randomPoint = () => ({ x: rand(pad, Math.max(pad, w - pad)), y: rand(pad, Math.max(pad, h - pad)) });

    if (agentsRef.current.length !== n) {
      agentsRef.current = Array.from({ length: n }, (_, i) => {
        const p = randomPoint();
        const t = randomPoint();
        return { x: p.x, y: p.y, vx: 0, vy: 0, tx: t.x, ty: t.y, retarget: rand(1.5, 4), speed: rand(70, 120), phase: i * 1.7, facing: 1 as const };
      });
    }
    const agents = agentsRef.current;

    let call: { x: number; y: number; until: number } | null = null;
    let pointer: { x: number; y: number } | null = null;

    const ro = new ResizeObserver(() => {
      w = box.clientWidth;
      h = box.clientHeight;
    });
    ro.observe(box);

    const local = (e: MouseEvent) => {
      const r = box.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    let markId = 0;
    const onClick = (e: MouseEvent) => {
      const p = local(e);
      if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) return; // outside the bees' sky
      call = { ...p, until: performance.now() + 2600 };
      const id = ++markId;
      setMarks((m) => [...m.slice(-2), { id, ...p }]);
      window.setTimeout(() => setMarks((m) => m.filter((k) => k.id !== id)), 1800);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") pointer = local(e);
    };
    const onLeave = () => {
      pointer = null;
    };
    if (interactive && host) {
      host.addEventListener("click", onClick);
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
    }

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      if (call && now > call.until) call = null;

      agents.forEach((a, i) => {
        let tx = a.tx;
        let ty = a.ty;
        let speed = a.speed;
        if (call) {
          // Circle the called spot in a loose figure-eight, each bee on its own lap.
          const ang = t * 2.4 + i * ((Math.PI * 2) / agents.length);
          tx = call.x + Math.sin(ang) * 46;
          ty = call.y + Math.sin(ang * 2) * 22;
          speed = a.speed * 2.2;
        } else if (i === 0 && pointer) {
          tx = pointer.x - 36 * a.facing;
          ty = pointer.y - 18;
          speed = a.speed * 1.4;
        } else {
          a.retarget -= dt;
          const dx = a.tx - a.x;
          const dy = a.ty - a.y;
          if (a.retarget <= 0 || dx * dx + dy * dy < 900) {
            const p = randomPoint();
            a.tx = p.x;
            a.ty = p.y;
            a.retarget = rand(2, 5);
          }
        }

        // Steer toward the target, with a wobble so the flight never looks mechanical.
        const dx = tx - a.x;
        const dy = ty - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const wobble = Math.sin(t * 7 + a.phase) * 40;
        const desiredX = (dx / dist) * speed - (dy / dist) * wobble * 0.5;
        const desiredY = (dy / dist) * speed + (dx / dist) * wobble * 0.5 + Math.cos(t * 5 + a.phase) * 18;
        const steer = call ? 4 : 2.2;
        a.vx += (desiredX - a.vx) * Math.min(1, steer * dt);
        a.vy += (desiredY - a.vy) * Math.min(1, steer * dt);
        a.x = Math.min(w + 40, Math.max(-40, a.x + a.vx * dt));
        a.y = Math.min(h + 40, Math.max(-40, a.y + a.vy * dt));

        // Only turn around on a clear change of direction, so bees don't flicker left/right.
        if (a.vx > 12) a.facing = 1;
        else if (a.vx < -12) a.facing = -1;
        const tilt = Math.max(-28, Math.min(28, (Math.atan2(a.vy, Math.abs(a.vx) + 1) * 180) / Math.PI)) * 0.7;

        const el = beeRefs.current[i];
        if (el) el.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0) rotate(${(tilt * a.facing).toFixed(1)}deg) scaleX(${a.facing})`;
      });
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    start();
    beeRefs.current.forEach((el) => el?.setAttribute("data-live", ""));
    document.addEventListener("visibilitychange", start);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", start);
      if (interactive && host) {
        host.removeEventListener("click", onClick);
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerleave", onLeave);
      }
    };
  }, [budget, inView, n, interactive]);

  return (
    <div
      ref={ref}
      aria-hidden
      data-fx-paused={pausedAttr(inView, budget)}
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {pollen && budget !== "off" && <Pollen tone={tone} dense={budget === "full"} />}

      {marks.map((m) => (
        <svg key={m.id} className={cn("waggle-mark", tone === "inverse" && "waggle-mark-inverse")} viewBox="0 0 120 60" style={{ left: m.x - 60, top: m.y - 30 }}>
          <path pathLength={100} d="M60 30C40 4 8 8 8 30s32 26 52 0 52-26 52 0-32 26-52 0" />
        </svg>
      ))}

      {Array.from({ length: n }, (_, i) => {
        const size = SIZES[i % SIZES.length];
        // Reduced motion: a few bees resting along the top edge, no loop.
        const rest = budget === "off" ? { left: `${18 + i * 30}%`, top: `${14 + (i % 2) * 18}%` } : undefined;
        return (
          <span
            key={i}
            ref={(el) => {
              beeRefs.current[i] = el;
            }}
            className="swarm-bee"
            style={{ ...rest, marginLeft: -size / 2, marginTop: -size / 2, ...(rest ? { opacity: 1 } : null) }}
          >
            <span className="swarm-bob" style={cssVars({ "--delay": `${-i * 0.37}s` })}>
              <Bee variant={VARIANTS[i % VARIANTS.length]} tone={tone} size={size} flying={budget !== "off"} />
            </span>
          </span>
        );
      })}
    </div>
  );
}

const SPECKS = [
  { x: 8, d: 0, s: 14 },
  { x: 22, d: -5, s: 18 },
  { x: 37, d: -9, s: 12 },
  { x: 51, d: -2, s: 16 },
  { x: 64, d: -7, s: 20 },
  { x: 78, d: -11, s: 15 },
  { x: 90, d: -4, s: 17 },
  { x: 15, d: -13, s: 19 },
  { x: 45, d: -15, s: 13 },
  { x: 71, d: -1, s: 22 },
];

/** Pollen specks rising slowly through the space. */
function Pollen({ tone, dense }: { tone: "default" | "inverse"; dense: boolean }) {
  return (
    <>
      {(dense ? SPECKS : SPECKS.slice(0, 5)).map((p, i) => (
        <span
          key={i}
          className={cn("pollen", tone === "inverse" && "pollen-inverse")}
          style={cssVars({ "--x": `${p.x}%`, "--delay": `${p.d}s`, "--dur": `${p.s}s`, "--size": `${3 + (i % 3) * 2}px` })}
        />
      ))}
    </>
  );
}
