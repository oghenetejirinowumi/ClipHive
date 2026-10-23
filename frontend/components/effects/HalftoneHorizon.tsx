"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { useInView, useMotionBudget } from "./useMotion";

// The sphere's centre sits below the canvas, so only its top cap is visible. With the centre
// at h + 0.42R, a point shows only if its height on the unit sphere is above 0.42.
const CENTRE_DROP = 0.42;
const FRAME_MS = 33; // ~30fps is plenty for a slow spin

/** Fibonacci-sphere points, keeping only the cap that can ever appear on screen. */
function capPoints(total: number): Float32Array {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: number[] = [];
  for (let i = 0; i < total; i++) {
    const y = 1 - (2 * (i + 0.5)) / total;
    if (y <= CENTRE_DROP) continue;
    const r = Math.sqrt(1 - y * y);
    out.push(Math.cos(i * golden) * r, y, Math.sin(i * golden) * r);
  }
  return new Float32Array(out);
}

/**
 * A slowly turning planet of halftone dots rising over the bottom edge: bright at the rim,
 * sparse in the middle. Dots use the element's text colour, so it follows light/dark mode.
 * Size it with className (e.g. `h-80 w-full`).
 */
export function HalftoneHorizon({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const budget = useMotionBudget();
  const inView = useInView(canvasRef, { rootMargin: "120px" });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const points = capPoints(budget === "full" ? 18000 : 9000);
    let width = 0;
    let height = 0;
    let color = getComputedStyle(canvas).color;
    let angle = 0.6;
    let raf = 0;
    let last = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      // Cap the radius so the top of the sphere (at h - 0.58R) stays inside the canvas.
      const radius = Math.min(width * 0.58, height * 1.55);
      const cx = width / 2;
      const cy = height + radius * CENTRE_DROP;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const unit = Math.max(1.4, radius / 380);

      for (let i = 0; i < points.length; i += 3) {
        const x = points[i] * cos + points[i + 2] * sin;
        const z = points[i + 2] * cos - points[i] * sin;
        if (z < 0) continue; // far side
        const py = cy - points[i + 1] * radius;
        if (py < -4 || py > height + 4) continue;
        const px = cx + x * radius;
        // Rim-lit halftone: dots grow and brighten towards the silhouette.
        const rim = 1 - z;
        const tone = 0.18 + 0.82 * rim * rim;
        const size = unit * (0.55 + 1.5 * tone);
        ctx.globalAlpha = Math.min(1, 0.12 + tone);
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    };

    const animate = budget !== "off" && inView;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_MS) return;
      last = t;
      angle += 0.0022;
      draw();
    };

    resize();
    draw();
    if (animate) raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);

    // Re-read the dot colour when the theme flips.
    const mo = new MutationObserver(() => {
      color = getComputedStyle(canvas).color;
      draw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [budget, inView]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("pointer-events-none block text-ink [mask-image:linear-gradient(to_bottom,black_45%,transparent)]", className)}
    />
  );
}
