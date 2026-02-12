"use client";

import { useState, useCallback } from "react";
import { toast } from "@/app/lib/use-toast";
import type { ProbeMethod, ProbeResponse } from "@/app/lib/types";

interface LogEntry {
  timestamp: string;
  message: string;
  success: boolean | null;
  details?: string;
  timing?: number;
  portInfo?: ProbeResponse["portInfo"];
}

interface DriverProbeProps {
  selectedPort: string | null;
  onProbeSuccess: (method: string) => void;
}

interface ProtocolInfo {
  method: ProbeMethod;
  label: string;
  description: string;
  testFrame: boolean;
  needsPort: boolean;
  badge: string;
}

const PROTOCOLS: ProtocolInfo[] = [
  {
    method: "soundswitch",
    label: "SoundSwitch Micro DMX",
    description: "Direct USB connection via JLS1 protocol. No serial port needed. Close the SoundSwitch desktop app first.",
    testFrame: true,
    needsPort: false,
    badge: "USB Direct",
  },
  {
    method: "enttec-open",
    label: "Enttec Open DMX USB",
    description: "FTDI-based USB-to-DMX adapter. Common and affordable (~$20). Uses 250k baud serial.",
    testFrame: false,
    needsPort: true,
    badge: "Serial",
  },
  {
    method: "enttec-pro",
    label: "Enttec DMX USB Pro",
    description: "Professional adapter with framed packet protocol at 57600 baud. More reliable than Open DMX.",
    testFrame: false,
    needsPort: true,
    badge: "Serial",
  },
  {
    method: "raw-serial",
    label: "Raw DMX (Break + Frame)",
    description: "Generic USB-to-RS485/XLR adapter. Sends DMX break signal then 513-byte frame at 250k baud 8N2.",
    testFrame: true,
    needsPort: true,
    badge: "Serial",
  },
  {
    method: "raw-250k",
    label: "250k Baud Test",
    description: "Quick check if your serial adapter supports 250000 baud (required for DMX). No data sent.",
    testFrame: false,
    needsPort: true,
    badge: "Test Only",
  },
];

export default function DriverProbe({ selectedPort, onProbeSuccess }: DriverProbeProps) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  const now = () =>
    new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const runProbe = useCallback(
    async (method: ProbeMethod, testFrame: boolean) => {
      const portLabel = method === "soundswitch" ? "USB direct" : selectedPort;
      if (!portLabel) return false;

      const entry: LogEntry = {
        timestamp: now(),
        message: `Probing ${portLabel} with ${method}...`,
        success: null,
      };
      setLog((prev) => [entry, ...prev]);

      try {
        const res = await fetch("/api/probe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ port: selectedPort || "usb-direct", method, testFrame }),
        });

        const data: ProbeResponse = await res.json();

        const resultEntry: LogEntry = {
          timestamp: now(),
          message: data.success
            ? `SUCCESS (${data.timing}ms): ${data.details}`
            : `FAILED (${data.timing}ms): ${data.error}`,
          success: data.success,
          details: data.details,
          timing: data.timing,
          portInfo: data.portInfo,
        };
        setLog((prev) => [resultEntry, ...prev]);

        if (data.success) {
          onProbeSuccess(method);
          toast.success(`Connected via ${method}`);
        }

        return data.success;
      } catch (err) {
        const errorEntry: LogEntry = {
          timestamp: now(),
          message: `ERROR: ${err instanceof Error ? err.message : "Network error"}`,
          success: false,
        };
        setLog((prev) => [errorEntry, ...prev]);
        toast.error("Probe failed");
        return false;
      }
    },
    [selectedPort, onProbeSuccess]
  );

  const runSingle = useCallback(
    async (proto: ProtocolInfo) => {
      if (proto.needsPort && !selectedPort) {
        toast.warning("Select a serial port first");
        return;
      }
      setRunning(proto.method);
      await runProbe(proto.method, proto.testFrame);
      setRunning(null);
    },
    [runProbe, selectedPort]
  );

  const runAll = useCallback(async () => {
    setRunningAll(true);
    for (const p of PROTOCOLS) {
      if (p.needsPort && !selectedPort) continue;
      setRunning(p.method);
      const success = await runProbe(p.method, p.testFrame);
      if (success) break;
    }
    setRunning(null);
    setRunningAll(false);
  }, [runProbe, selectedPort]);

  const isRunning = running !== null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Connection Protocol</h2>
        <button
          onClick={runAll}
          disabled={isRunning}
          className="min-h-11 rounded-lg bg-accent-muted px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
        >
          {runningAll ? "Testing..." : "Auto-Detect"}
        </button>
      </div>

      <p className="text-sm text-text-muted">
        Choose your adapter type, or hit Auto-Detect to try all protocols.
        {!selectedPort && " Scan for ports above to enable serial protocols."}
      </p>

      {/* Protocol cards */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PROTOCOLS.map((proto) => {
          const disabled = isRunning || (proto.needsPort && !selectedPort);
          const isActive = running === proto.method;
          return (
            <button
              key={proto.method}
              onClick={() => runSingle(proto)}
              disabled={disabled}
              className={`group rounded-lg border p-3 text-left transition-all ${
                isActive
                  ? "border-accent bg-accent/10"
                  : disabled
                    ? "border-border/50 opacity-40"
                    : "border-border hover:border-accent/50 hover:bg-surface-3"
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium">
                  {isActive ? "Probing..." : proto.label}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  proto.needsPort
                    ? "bg-surface-3 text-text-muted"
                    : "bg-accent-muted text-accent"
                }`}>
                  {proto.badge}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-text-muted">
                {proto.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Log output */}
      {log.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-text-muted hover:text-text-secondary">
            Probe Log ({log.length} entries)
          </summary>
          <div
            className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-1 p-3 font-mono text-xs"
            role="log"
            aria-live="polite"
            aria-label="Probe results"
          >
            {log.map((entry, i) => (
              <div
                key={i}
                className={`mb-1 ${
                  entry.success === true
                    ? "text-success"
                    : entry.success === false
                      ? "text-error"
                      : "text-text-muted"
                }`}
              >
                <span className="text-text-muted/60">[{entry.timestamp}]</span>{" "}
                {entry.success === true ? "\u2713 " : entry.success === false ? "\u2717 " : ""}
                {entry.message}
                {entry.portInfo && entry.success && (
                  <div className="ml-4 text-text-muted">
                    {entry.portInfo.baudRate} baud, {entry.portInfo.dataBits}
                    {entry.portInfo.parity?.[0].toUpperCase()}
                    {entry.portInfo.stopBits}
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
