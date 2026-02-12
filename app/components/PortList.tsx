"use client";

import { useState } from "react";
import type { PortInfo, PortsResponse, UsbDeviceInfo, UsbResponse } from "@/app/lib/types";

interface PortListProps {
  selectedPort: string | null;
  onSelectPort: (path: string) => void;
}

export default function PortList({ selectedPort, onSelectPort }: PortListProps) {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [usbDevices, setUsbDevices] = useState<UsbDeviceInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scanAll() {
    setScanning(true);
    setError(null);

    try {
      const [portsRes, usbRes] = await Promise.all([
        fetch("/api/ports", { method: "POST" }),
        fetch("/api/usb", { method: "POST" }),
      ]);

      if (portsRes.ok) {
        const data: PortsResponse = await portsRes.json();
        setPorts(data.ports);
      } else {
        const err = await portsRes.json();
        setError(err.error || "Failed to scan serial ports");
      }

      if (usbRes.ok) {
        const data: UsbResponse = await usbRes.json();
        setUsbDevices(data.devices.filter((d) => d.deviceClass !== 9));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setScanning(false);
      setScanned(true);
    }
  }

  const categoryBadge = (cat: string) => {
    switch (cat) {
      case "ftdi":
        return { label: "FTDI", cls: "bg-success/15 text-success" };
      case "soundswitch":
        return { label: "SoundSwitch", cls: "bg-warning/15 text-warning" };
      default:
        return { label: "Serial", cls: "bg-surface-3 text-text-muted" };
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Serial Ports</h3>
          <p className="text-xs text-text-muted">
            {scanned
              ? ports.length > 0
                ? "Select a port for serial DMX protocols"
                : "No serial ports found"
              : "Scan to detect USB-to-serial adapters"}
          </p>
        </div>
        <button
          onClick={scanAll}
          disabled={scanning}
          className="min-h-11 rounded-lg bg-accent-muted px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
        >
          {scanning ? "Scanning..." : scanned ? "Rescan" : "Scan Ports"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error" role="alert">
          {error}
        </div>
      )}

      {/* Port cards */}
      {ports.length > 0 && (
        <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Serial port selection">
          {ports.map((p) => {
            const selected = selectedPort === p.path;
            const badge = categoryBadge(p.category);
            return (
              <button
                key={p.path}
                role="radio"
                aria-checked={selected}
                onClick={() => onSelectPort(p.path)}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  selected
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-accent/50 hover:bg-surface-3"
                }`}
              >
                {/* Radio indicator */}
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  selected ? "border-accent" : "border-text-muted/40"
                }`}>
                  {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm">{p.path}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    {p.manufacturer || "Unknown manufacturer"}
                    {p.vendorId && p.productId && (
                      <span className="ml-2 font-mono">{p.vendorId}:{p.productId}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Low-level USB devices — collapsed by default */}
      {scanned && usbDevices.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-text-muted hover:text-text-secondary">
            {usbDevices.length} USB device{usbDevices.length !== 1 ? "s" : ""} detected (low-level)
          </summary>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface-1 p-3">
            <table className="w-full text-left text-xs" aria-label="USB devices">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="pb-2 pr-4">VID:PID</th>
                  <th className="pb-2 pr-4">Class</th>
                  <th className="pb-2">Bus:Addr</th>
                </tr>
              </thead>
              <tbody>
                {usbDevices.map((d, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1.5 pr-4 font-mono">
                      {d.vendorId.toString(16).padStart(4, "0")}:
                      {d.productId.toString(16).padStart(4, "0")}
                    </td>
                    <td className={`py-1.5 pr-4 ${d.classLabel === "Vendor Specific" ? "text-warning" : ""}`}>
                      {d.classLabel}
                    </td>
                    <td className="py-1.5 font-mono">
                      {d.busNumber}:{d.deviceAddress}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
