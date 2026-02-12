import { useSyncExternalStore, useCallback } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

type Listener = () => void;

const AUTO_DISMISS: Record<ToastType, number> = {
  success: 3000,
  info: 3000,
  warning: 5000,
  error: 8000,
};

const MAX_VISIBLE = 3;

// ── Module-level store ──

let toasts: Toast[] = [];
let listeners: Listener[] = [];

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: Listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot(): Toast[] {
  return toasts;
}

function addToast(type: ToastType, message: string, duration?: number) {
  const id = crypto.randomUUID();
  const ms = duration ?? AUTO_DISMISS[type];
  const toast: Toast = { id, type, message, duration: ms };

  toasts = [...toasts.slice(-(MAX_VISIBLE - 1)), toast];
  emit();

  if (ms > 0) {
    setTimeout(() => dismissToast(id), ms);
  }
}

function dismissToast(id: string) {
  const prev = toasts;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts !== prev) emit();
}

// ── Public API ──

export function toast(type: ToastType, message: string, duration?: number) {
  addToast(type, message, duration);
}

toast.success = (message: string) => addToast("success", message);
toast.error = (message: string) => addToast("error", message);
toast.info = (message: string) => addToast("info", message);
toast.warning = (message: string) => addToast("warning", message);

export function useToasts() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const dismiss = useCallback((id: string) => dismissToast(id), []);
  return { toasts: items, dismiss };
}
