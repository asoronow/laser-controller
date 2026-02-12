"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTour, type TourStep } from "@/app/lib/use-tour";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getTargetRect(target: string): Rect | null {
  const els = document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`);
  for (const el of els) {
    // Skip hidden elements (desktop tabs on mobile, etc.)
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") {
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    }
  }
  return null;
}

const PADDING = 8;
const GAP = 12;
const TOOLTIP_W = 320;

function computeTooltipPosition(
  rect: Rect | null,
  placement: TourStep["placement"]
): React.CSSProperties {
  // Welcome / no target: center on screen
  if (!rect) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  const clampX = (x: number) =>
    Math.max(16, Math.min(x, window.innerWidth - TOOLTIP_W - 16));

  const centerX = clampX(rect.left + rect.width / 2 - TOOLTIP_W / 2);

  switch (placement) {
    case "bottom": {
      const top = rect.top + rect.height + PADDING + GAP;
      // Flip to top if off-screen
      if (top + 160 > window.innerHeight) {
        return {
          top: rect.top - PADDING - GAP,
          left: centerX,
          transform: "translateY(-100%)",
        };
      }
      return { top, left: centerX };
    }
    case "top":
      return {
        top: rect.top - PADDING - GAP,
        left: centerX,
        transform: "translateY(-100%)",
      };
    case "left":
      return {
        top: rect.top + rect.height / 2,
        left: rect.left - PADDING - GAP,
        transform: "translate(-100%, -50%)",
      };
    case "right":
      return {
        top: rect.top + rect.height / 2,
        left: rect.left + rect.width + PADDING + GAP,
        transform: "translateY(-50%)",
      };
  }
}

export default function TourOverlay() {
  const { active, stepIndex, step, totalSteps, next, prev, end } = useTour();
  const [rect, setRect] = useState<Rect | null>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);

  const updateRect = useCallback(() => {
    if (!step) return;
    if (step.target === "welcome") {
      setRect(null);
      return;
    }
    setRect(getTargetRect(step.target));
  }, [step]);

  // Recalculate on step change, resize, scroll
  useEffect(() => {
    if (!active) return;
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [active, updateRect]);

  // Focus the Next button on step change
  useEffect(() => {
    if (active && nextBtnRef.current) {
      nextBtnRef.current.focus();
    }
  }, [active, stepIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        end();
        e.preventDefault();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        next();
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        prev();
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, next, prev, end]);

  if (!active || !step) return null;

  const isWelcome = step.target === "welcome";
  const tooltipPos = computeTooltipPosition(isWelcome ? null : rect, step.placement);

  return (
    <>
      {/* Dark backdrop — welcome gets full coverage, others use box-shadow spotlight */}
      {isWelcome && (
        <div
          className="fixed inset-0 z-[199] bg-black/75"
          onClick={end}
          style={{ animation: "tourFadeIn 0.2s ease-out" }}
        />
      )}

      {/* Spotlight cutout via box-shadow */}
      {!isWelcome && rect && (
        <div
          aria-hidden="true"
          className="fixed z-[200] rounded-lg"
          style={{
            top: rect.top - PADDING,
            left: rect.left - PADDING,
            width: rect.width + PADDING * 2,
            height: rect.height + PADDING * 2,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.75)",
            pointerEvents: "none",
            transition: "top 0.3s ease, left 0.3s ease, width 0.3s ease, height 0.3s ease",
          }}
        />
      )}

      {/* Click-away backdrop for non-welcome steps */}
      {!isWelcome && (
        <div
          className="fixed inset-0 z-[199]"
          onClick={end}
        />
      )}

      {/* Tooltip */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Tour step ${stepIndex + 1} of ${totalSteps}: ${step.title}`}
        className="fixed z-[201] w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-accent/30 bg-surface-2 p-4 shadow-2xl"
        style={{
          ...tooltipPos,
          animation: "tourFadeIn 0.2s ease-out",
        }}
      >
        {/* Screen reader announcement */}
        <div aria-live="polite" className="sr-only">
          Step {stepIndex + 1} of {totalSteps}: {step.title}. {step.body}
        </div>

        <p className="mb-1 text-sm font-semibold text-accent">{step.title}</p>
        <p className="mb-4 text-sm leading-relaxed text-text-secondary">
          {step.body}
        </p>

        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {stepIndex + 1} / {totalSteps}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={end}
              className="rounded px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:text-text-secondary"
            >
              Skip
            </button>

            {stepIndex > 0 && (
              <button
                onClick={prev}
                className="rounded border border-border px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-3"
              >
                Back
              </button>
            )}

            <button
              ref={nextBtnRef}
              onClick={next}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-surface-0 transition-colors hover:bg-accent-hover"
            >
              {stepIndex < totalSteps - 1 ? "Next" : "Finish"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
