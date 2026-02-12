"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import PortList from "@/app/components/PortList";
import DriverProbe from "@/app/components/DriverProbe";
import DMXTestPanel from "@/app/components/DMXTestPanel";
import StatusBadge from "@/app/components/StatusBadge";
import type { StatusResponse } from "@/app/lib/types";

type Verdict = "idle" | "no-ports" | "probing" | "success" | "failed";

export default function ExplorePage() {
  const [selectedPort, setSelectedPort] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [connectedMethod, setConnectedMethod] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict>("idle");

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const data: StatusResponse = await res.json();
        setStatus(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleProbeSuccess = useCallback(
    (method: string) => {
      setConnectedMethod(method);
      setVerdict("success");
      refreshStatus();
    },
    [refreshStatus]
  );

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold md:text-2xl">Adapter Explorer</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Probe your SoundSwitch DMX adapter to see if it can be driven by
              generic libraries
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={status} />
            <Link
              href="/"
              className="min-h-11 flex items-center rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:text-text-primary"
            >
              Home
            </Link>
          </div>
        </div>

        {/* Section 1: Port Scanner */}
        <PortList selectedPort={selectedPort} onSelectPort={setSelectedPort} />

        {/* Section 2: Driver Probe */}
        <DriverProbe
          selectedPort={selectedPort}
          onProbeSuccess={handleProbeSuccess}
        />

        {/* Section 3: DMX Test Panel */}
        <DMXTestPanel
          connected={verdict === "success"}
          connectedPort={selectedPort}
          connectedMethod={connectedMethod}
        />

        {/* Section 4: Verdict Panel */}
        <VerdictPanel
          verdict={verdict}
          method={connectedMethod}
          port={selectedPort}
        />
      </div>
    </div>
  );
}

function VerdictPanel({
  verdict,
  method,
  port,
}: {
  verdict: Verdict;
  method: string | null;
  port: string | null;
}) {
  switch (verdict) {
    case "success":
      return (
        <div className="rounded-lg border border-success/30 bg-success/5 p-4" role="status">
          <p className="text-success">
            Your adapter works! Method:{" "}
            <span className="font-mono font-bold">{method}</span> @{" "}
            <span className="font-mono">{port}</span>. You can use this for the
            full controller.
          </p>
          <Link
            href="/simulate"
            className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-success/20 px-4 py-2 text-sm font-medium text-success transition-colors hover:bg-success/30"
          >
            Open Simulator
          </Link>
        </div>
      );

    case "failed":
      return (
        <div className="rounded-lg border border-error/30 bg-error/5 p-4" role="alert">
          <p className="text-error">
            The SoundSwitch adapter could not be driven by any generic method. It
            requires a proprietary protocol.
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            Recommended: buy a generic FTDI USB-DMX cable (~$15 on Amazon, search
            &ldquo;USB DMX 512 FTDI FT232&rdquo;). Your full controller UI works
            in simulation mode in the meantime.
          </p>
          <Link
            href="/simulate"
            className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent-muted px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25"
          >
            Use Simulator (no hardware)
          </Link>
        </div>
      );

    case "idle":
    default:
      return (
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <p className="text-text-muted">
            Plug in your DMX adapter and click Scan to begin.
          </p>
        </div>
      );
  }
}
