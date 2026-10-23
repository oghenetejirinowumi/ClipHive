"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * How much motion this device gets:
 *  - "off":  reduced-motion or Save-Data — effects render as still images.
 *  - "lite": phones / low-core / low-memory devices — fewer moving layers.
 *  - "full": everything.
 * Starts at "lite" so the server render and first paint are cheap.
 */
export type MotionBudget = "full" | "lite" | "off";

type NavigatorHints = Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };

function measure(reduced: boolean): MotionBudget {
  const nav = navigator as NavigatorHints;
  if (reduced || nav.connection?.saveData) return "off";
  const weak = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || window.matchMedia("(max-width: 640px)").matches;
  return weak ? "lite" : "full";
}

export function useMotionBudget(): MotionBudget {
  const [budget, setBudget] = useState<MotionBudget>("lite");

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setBudget(measure(mq.matches));
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return budget;
}

/** True while the element is on screen (or, with `once`, after it first appears). */
export function useInView<T extends Element>(ref: RefObject<T | null>, { once = false, rootMargin = "0px" } = {}): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && once) io.disconnect();
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, rootMargin]);

  return inView;
}

/** `data-fx-paused` value: freeze looping animations when offscreen or motion is off. */
export function pausedAttr(inView: boolean, budget: MotionBudget): "" | undefined {
  return !inView || budget === "off" ? "" : undefined;
}
