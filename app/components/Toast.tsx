"use client";

import { useToasts, type Toast as ToastItem } from "@/app/lib/use-toast";

const TYPE_STYLES: Record<ToastItem["type"], { bar: string; icon: string }> = {
  success: { bar: "bg-success", icon: "\u2713" },
  error: { bar: "bg-error", icon: "\u2715" },
  info: { bar: "bg-accent", icon: "\u2139" },
  warning: { bar: "bg-warning", icon: "!" },
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: () => void;
}) {
  const style = TYPE_STYLES[toast.type];

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      aria-live={toast.type === "error" ? "assertive" : "polite"}
      className="pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] animate-[slideIn_0.2s_ease-out] items-start gap-3 overflow-hidden rounded-lg border border-border bg-surface-2/95 shadow-lg backdrop-blur-sm"
    >
      <div className={`w-1 self-stretch ${style.bar}`} />
      <span
        className="mt-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-surface-0"
        style={{
          background: `var(--${toast.type === "success" ? "status-success" : toast.type === "error" ? "status-error" : toast.type === "warning" ? "status-warning" : "accent"})`,
        }}
        aria-hidden="true"
      >
        {style.icon}
      </span>
      <p className="flex-1 py-3 pr-2 text-sm text-text-primary">
        {toast.message}
      </p>
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="mr-2 mt-2.5 shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-secondary"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, dismiss } = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed top-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2 md:bottom-4 md:right-4 md:left-auto md:top-auto md:translate-x-0"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}
