"use client";

import type { StatusResponse } from "@/app/lib/types";

export default function StatusBadge({ status }: { status: StatusResponse | null }) {
  if (!status) {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label="Checking connection"
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-text-muted"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-text-muted" aria-hidden="true" />
      </span>
    );
  }

  if (status.connected && !status.simulation) {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label="Device connected"
        className="inline-flex items-center gap-1.5 rounded-full border border-success/30 px-2.5 py-1 text-xs text-success"
      >
        <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
        Connected
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label="No device connected"
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-text-muted"
    >
      <span className="h-2 w-2 rounded-full bg-text-muted" aria-hidden="true" />
      Offline
    </span>
  );
}
