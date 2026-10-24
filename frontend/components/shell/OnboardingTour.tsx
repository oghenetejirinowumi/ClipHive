"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bee } from "@/components/hive";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { setTourState, TOUR_START_EVENT, TOUR_STEPS, tourState } from "@/lib/tour";

type Box = { x: number; y: number; w: number; h: number };

const PAD = 8; // space between the highlighted element and the spotlight's edge
const GAP = 16;
const EDGE = 16;
const BEE = 46;
const GIVE_UP_MS = 3000; // after this, a missing target shows the step centred

function isVisible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

function findTarget(name: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(name)}"]`);
  return Array.from(all).find(isVisible) ?? null;
}

const sameBox = (a: Box | null, b: Box | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * The onboarding bee. Shown once after sign-up (lib/tour.ts) and whenever "Take the tour" is
 * pressed. Dims the page, spotlights one button at a time and flies a bee over to it with a
 * speech bubble. The page stays usable underneath: pressing the highlighted button works, and
 * on `clickToContinue` steps it also moves the tour on. Esc skips, arrow keys step.
 */
export function OnboardingTour() {
  const { user, status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [step, setStep] = useState<number | null>(null);
  // Both are tagged with their step, so a new step never briefly uses the last one's spot.
  const [found, setFound] = useState<{ step: number; box: Box } | null>(null);
  const [gaveUpOn, setGaveUpOn] = useState<number | null>(null);
  const [view, setView] = useState({ w: 1280, h: 800 });
  const [cardH, setCardH] = useState(220);
  const [facing, setFacing] = useState<1 | -1>(1);
  const cardRef = useRef<HTMLDivElement>(null);
  const lastBeeX = useRef<number | null>(null);

  const current = step === null ? null : TOUR_STEPS[step];
  const box = found && found.step === step ? found.box : null;
  const gaveUp = step !== null && gaveUpOn === step;
  // Wait for the step's page before looking for its target.
  const onPage = !current?.href || pathname === current.href;
  const last = step === TOUR_STEPS.length - 1;

  // Open for a brand-new account, or when asked to.
  const userId = user?.id;
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || status !== "authenticated" || userId === undefined) return;
    if (tourState(userId) === "pending") {
      autoOpened.current = true;
      setStep(0);
    }
  }, [status, userId]);

  useEffect(() => {
    const open = () => setStep(0);
    window.addEventListener(TOUR_START_EVENT, open);
    return () => window.removeEventListener(TOUR_START_EVENT, open);
  }, []);

  const finish = useCallback(() => {
    setStep(null);
    if (userId !== undefined) setTourState(userId, "done");
  }, [userId]);

  const next = useCallback(() => setStep((s) => (s === null ? null : s + 1 >= TOUR_STEPS.length ? null : s + 1)), []);
  const back = useCallback(() => setStep((s) => (s === null ? null : Math.max(0, s - 1))), []);

  // Open the step's page.
  useEffect(() => {
    if (current?.href && pathname !== current.href) router.push(current.href);
  }, [current, pathname, router]);

  // Find the target and keep the spotlight on it as the page moves.
  useEffect(() => {
    if (step === null || !current?.target || !onPage) return;
    const target = current.target;
    const at = step;
    let el: HTMLElement | null = null;
    let scrolled = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onTargetClick = () => {
      if (current.clickToContinue) next();
    };

    const measure = () => {
      if (!el || !el.isConnected || !isVisible(el)) {
        el?.removeEventListener("click", onTargetClick);
        el = findTarget(target);
        if (!el) return;
        el.addEventListener("click", onTargetClick);
      }
      const r = el.getBoundingClientRect();
      if (!scrolled && (r.top < 0 || r.bottom > window.innerHeight)) {
        scrolled = true;
        el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      }
      const b = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      setFound((prev) => (prev && prev.step === at && sameBox(prev.box, b) ? prev : { step: at, box: b }));
    };

    measure();
    const poll = setInterval(measure, 150);
    const giveUp = setTimeout(() => !el && setGaveUpOn(at), GIVE_UP_MS);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      el?.removeEventListener("click", onTargetClick);
    };
  }, [step, current, onPage, next]);

  useEffect(() => {
    if (step === null) return;
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [step]);

  // Keyboard: Esc skips, arrows step (not while typing in a field).
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable=true]");
      if (e.key === "Escape") finish();
      else if (typing) return;
      else if (e.key === "ArrowRight") {
        if (last) finish();
        else next();
      }
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, last, finish, next, back]);

  const hasBox = box !== null;
  // Measure the bubble once it's on screen (and again when its text changes) to place it.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    setCardH(card.offsetHeight);
    const ro = new ResizeObserver(() => setCardH(card.offsetHeight));
    ro.observe(card);
    return () => ro.disconnect();
  }, [step, hasBox, gaveUp]);

  const ready = !!current && (!current.target || !!box || gaveUp);

  // Move focus to the bubble so keyboard and screen-reader users follow the bee.
  useEffect(() => {
    if (ready) cardRef.current?.querySelector<HTMLButtonElement>("[data-tour-next]")?.focus({ preventScroll: true });
  }, [ready, step]);

  // Where the card and the bee go.
  const cardW = Math.min(352, view.w - EDGE * 2);
  const hole = box ? { x: box.x - PAD, y: box.y - PAD, w: box.w + PAD * 2, h: box.h + PAD * 2 } : null;
  let cardX = (view.w - cardW) / 2;
  let cardY = (view.h - cardH) / 2;
  if (hole) {
    const inSidebar = view.w >= 1024 && hole.x + hole.w < 420;
    const below = view.h - (hole.y + hole.h);
    if (inSidebar) {
      cardX = hole.x + hole.w + GAP;
      cardY = clamp(hole.y - 12, EDGE, view.h - cardH - EDGE);
    } else if (below >= cardH + GAP + EDGE || hole.y < cardH + GAP + EDGE) {
      cardX = clamp(hole.x + hole.w / 2 - cardW / 2, EDGE, view.w - cardW - EDGE);
      cardY = clamp(hole.y + hole.h + GAP, EDGE, view.h - cardH - EDGE);
    } else {
      cardX = clamp(hole.x + hole.w / 2 - cardW / 2, EDGE, view.w - cardW - EDGE);
      cardY = hole.y - GAP - cardH;
    }
  }
  // The bee perches on the target's top-right corner, or above the card when there's no target.
  const beeX = hole ? clamp(hole.x + hole.w - BEE * 0.55, EDGE, view.w - BEE - EDGE) : cardX + cardW / 2 - BEE / 2;
  const beeY = hole ? clamp(hole.y - BEE * 0.8, EDGE, view.h - BEE - EDGE) : cardY - BEE - 6;

  useEffect(() => {
    if (!ready) return;
    if (lastBeeX.current !== null && Math.abs(beeX - lastBeeX.current) > 4) setFacing(beeX >= lastBeeX.current ? 1 : -1);
    lastBeeX.current = beeX;
  }, [ready, beeX]);

  useEffect(() => {
    if (step === null) lastBeeX.current = null;
  }, [step]);

  if (step === null || !current) return null;

  return (
    <div className="tour" aria-live="polite">
      {/* Dim everything except the target. Clicks pass straight through to the page. */}
      {hole ? (
        <div className="tour-spotlight" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} />
      ) : (
        <div className="tour-dim" />
      )}

      {ready && (
        <>
          <div className="tour-bee" style={{ transform: `translate(${beeX}px, ${beeY}px)` }}>
            <div className="tour-bee-bob">
              <div className="tour-bee-face" style={{ transform: `scaleX(${facing})` }}>
                <Bee variant="scout" size={BEE} flying />
              </div>
            </div>
          </div>

          <div
            ref={cardRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="tour-title"
            aria-describedby="tour-body"
            className="tour-card"
            style={{ width: cardW, transform: `translate(${cardX}px, ${cardY}px)` }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-meta font-medium text-ink-faint">
                {step + 1} of {TOUR_STEPS.length}
              </span>
              <button type="button" onClick={finish} className="min-h-11 rounded-full px-3 text-meta font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink">
                Skip tour
              </button>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-sunken">
              <div className="h-full rounded-full bg-brand transition-[width] duration-(--motion-base)" style={{ width: `${((step + 1) / TOUR_STEPS.length) * 100}%` }} />
            </div>
            <h2 id="tour-title" className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink">
              {current.title}
            </h2>
            <p id="tour-body" className="mt-2 text-base text-ink-muted">
              {current.body}
            </p>
            {current.clickToContinue && hole && <p className="mt-2 text-meta font-medium text-brand-strong">Press the highlighted button, or Next.</p>}
            <div className={cn("mt-5 flex items-center gap-2", step > 0 ? "justify-between" : "justify-end")}>
              {step > 0 && (
                <Button variant="ghost" size="sm" onClick={back}>
                  Back
                </Button>
              )}
              <Button data-tour-next size="sm" onClick={last ? finish : next}>
                {step === 0 ? "Show me around" : last ? "Let's go" : "Next"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
