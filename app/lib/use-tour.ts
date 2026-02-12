import { useSyncExternalStore, useCallback } from "react";

export interface TourStep {
  /** Matches data-tour="..." on the target element */
  target: string;
  /** Heading shown in the tooltip */
  title: string;
  /** Body text */
  body: string;
  /** Preferred placement relative to target */
  placement: "top" | "bottom" | "left" | "right";
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: "welcome",
    title: "Welcome to DMX Control",
    body: "This app lets you control a laser fixture over DMX. Let\u2019s take a quick tour of the key areas.",
    placement: "bottom",
  },
  {
    target: "tab-scenes",
    title: "Scenes",
    body: "Browse and apply preset laser patterns. Tap a scene card to load it instantly.",
    placement: "bottom",
  },
  {
    target: "tab-channels",
    title: "Channels",
    body: "Fine-tune individual DMX channels with sliders for precise control over your fixture.",
    placement: "bottom",
  },
  {
    target: "tab-fuzzer",
    title: "Fuzzer",
    body: "Randomly generate new scene combinations. Great for discovering unexpected looks.",
    placement: "bottom",
  },
  {
    target: "tab-show",
    title: "Show Mode",
    body: "Audio-reactive live mode. Uses your microphone to sync laser patterns to music.",
    placement: "bottom",
  },
  {
    target: "tab-setup",
    title: "Setup",
    body: "Connect your SoundSwitch DMX adapter here before sending data to the fixture.",
    placement: "bottom",
  },
  {
    target: "blackout-btn",
    title: "Blackout",
    body: "Emergency kill switch. Instantly sets all channels to zero. Always within reach.",
    placement: "bottom",
  },
  {
    target: "help-btn",
    title: "Need Help?",
    body: "Tap this button anytime to replay this tour. Enjoy!",
    placement: "bottom",
  },
];

const STORAGE_KEY = "laser-tour-seen";

// ── Module-level state ──

interface TourState {
  active: boolean;
  stepIndex: number;
}

let state: TourState = { active: false, stepIndex: 0 };
let listeners: (() => void)[] = [];

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot(): TourState {
  return state;
}

// ── Public API ──

export function startTour() {
  state = { active: true, stepIndex: 0 };
  emit();
}

export function autoStartTour() {
  try {
    if (!localStorage.getItem(STORAGE_KEY)) {
      startTour();
    }
  } catch {}
}

export function nextStep() {
  if (!state.active) return;
  if (state.stepIndex >= TOUR_STEPS.length - 1) {
    endTour();
  } else {
    state = { ...state, stepIndex: state.stepIndex + 1 };
    emit();
  }
}

export function prevStep() {
  if (!state.active || state.stepIndex <= 0) return;
  state = { ...state, stepIndex: state.stepIndex - 1 };
  emit();
}

export function endTour() {
  state = { active: false, stepIndex: 0 };
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {}
  emit();
}

// ── Hook ──

export function useTour() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    active: snap.active,
    stepIndex: snap.stepIndex,
    step: snap.active ? TOUR_STEPS[snap.stepIndex] : null,
    totalSteps: TOUR_STEPS.length,
    next: useCallback(() => nextStep(), []),
    prev: useCallback(() => prevStep(), []),
    end: useCallback(() => endTour(), []),
    start: useCallback(() => startTour(), []),
  };
}
