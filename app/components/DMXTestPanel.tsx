"use client";

import { useState, useCallback } from "react";

interface DMXTestPanelProps {
  connected: boolean;
  connectedPort: string | null;
  connectedMethod: string | null;
}

export default function DMXTestPanel({
  connected,
  connectedPort,
  connectedMethod,
}: DMXTestPanelProps) {
  const [laserOnOff, setLaserOnOff] = useState(0);
  const [groupSelect, setGroupSelect] = useState(0);
  const [pattern, setPattern] = useState(0);
  const [zoom, setZoom] = useState(64);
  const [colorChange, setColorChange] = useState(0);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = useCallback(
    async (channels: Record<number, number>) => {
      setSending(true);
      try {
        const res = await fetch("/api/dmx/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channels }),
        });
        if (res.ok) {
          const entries = Object.entries(channels)
            .map(([ch, val]) => `CH${ch}=${val}`)
            .join(" ");
          setLastSent(`${entries} \u2014 just now`);
        }
      } finally {
        setSending(false);
      }
    },
    []
  );

  const sendAll = useCallback(() => {
    send({
      1: laserOnOff,
      3: groupSelect,
      4: pattern,
      5: zoom,
      12: colorChange,
    });
  }, [send, laserOnOff, groupSelect, pattern, zoom, colorChange]);

  const sendSSMatch = useCallback(() => {
    setLaserOnOff(100);
    setGroupSelect(255);
    setPattern(28);
    setZoom(64);
    setColorChange(0);
    send({
      1: 100,
      3: 255,
      4: 28,
      5: 64,
      11: 152,
      15: 217,
    });
  }, [send]);

  const blackout = useCallback(async () => {
    await fetch("/api/dmx/blackout", { method: "POST" });
    setLaserOnOff(0);
    setLastSent("BLACKOUT \u2014 just now");
  }, []);

  if (!connected) {
    return (
      <section className="rounded-lg border border-border bg-surface-2 p-4 opacity-50">
        <h2 className="text-lg font-semibold">DMX Test Panel</h2>
        <p className="mt-2 text-sm text-text-muted">
          Connect to an adapter via probe first.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-success/30 bg-surface-2 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">DMX Test Panel</h2>
        <span className="text-xs text-success font-mono">
          {connectedMethod} @ {connectedPort}
        </span>
      </div>

      <div className="space-y-3">
        {/* CH1: Laser On/Off */}
        <div>
          <span className="mb-1 block text-sm text-text-secondary">CH1 Laser On/Off</span>
          <div className="flex gap-2" role="radiogroup" aria-label="Laser on/off mode">
            {[
              { label: "OFF", val: 0 },
              { label: "AUTO", val: 50 },
              { label: "SOUND", val: 100 },
            ].map((m) => (
              <button
                key={m.label}
                role="radio"
                aria-checked={laserOnOff === m.val}
                onClick={() => setLaserOnOff(m.val)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  laserOnOff === m.val
                    ? "border-accent/50 bg-accent-muted text-accent"
                    : "border-border hover:border-accent/50 hover:text-text-secondary"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* CH3: Group Selection */}
        <div>
          <span className="mb-1 block text-sm text-text-secondary">CH3 Group Selection</span>
          <div className="flex gap-2" role="radiogroup" aria-label="Group selection">
            {[
              { label: "BEAMS", val: 0 },
              { label: "ANIM", val: 255 },
            ].map((m) => (
              <button
                key={m.label}
                role="radio"
                aria-checked={groupSelect === m.val}
                onClick={() => setGroupSelect(m.val)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  groupSelect === m.val
                    ? "border-accent/50 bg-accent-muted text-accent"
                    : "border-border hover:border-accent/50 hover:text-text-secondary"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* CH4: Pattern & CH5: Zoom */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 flex items-center justify-between text-sm text-text-secondary">
              <span>CH4 Pattern</span>
              <span className="font-mono text-text-muted">{pattern}</span>
            </label>
            <input
              type="range"
              min={0}
              max={255}
              value={pattern}
              onChange={(e) => setPattern(Number(e.target.value))}
              aria-label="CH4 Pattern"
              aria-valuetext={`Pattern ${pattern}`}
              className="w-full"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between text-sm text-text-secondary">
              <span>CH5 Zoom</span>
              <span className="font-mono text-text-muted">{zoom}</span>
            </label>
            <input
              type="range"
              min={0}
              max={255}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="CH5 Zoom"
              aria-valuetext={`Zoom ${zoom}`}
              className="w-full"
            />
          </div>
        </div>

        {/* CH12: Color Change */}
        <div>
          <span className="mb-1 block text-sm text-text-secondary">CH12 Color</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color selection">
            {[
              { label: "ORIG", val: 0 },
              { label: "RED", val: 8 },
              { label: "GREEN", val: 24 },
              { label: "CYAN", val: 32 },
              { label: "BLUE", val: 40 },
              { label: "WHITE", val: 56 },
              { label: "7CLR", val: 160 },
            ].map((m) => (
              <button
                key={m.label}
                role="radio"
                aria-checked={colorChange === m.val}
                onClick={() => setColorChange(m.val)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  colorChange === m.val
                    ? "border-accent/50 bg-accent-muted text-accent"
                    : "border-border hover:border-accent/50 hover:text-text-secondary"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={sendAll}
            disabled={sending}
            className="min-h-11 flex-1 rounded-lg bg-success/20 py-2.5 text-sm font-medium text-success transition-colors hover:bg-success/30 disabled:opacity-50"
          >
            {sending ? "Sending..." : "SEND"}
          </button>
          <button
            onClick={sendSSMatch}
            disabled={sending}
            className="min-h-11 rounded-lg bg-accent-muted px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
          >
            SS Match
          </button>
          <button
            onClick={blackout}
            className="min-h-11 rounded-lg bg-error/20 px-4 py-2.5 text-sm font-medium text-error transition-colors hover:bg-error/30"
          >
            Blackout
          </button>
        </div>

        {lastSent && (
          <p className="text-xs text-text-muted">
            Last sent: {lastSent}
          </p>
        )}
      </div>
    </section>
  );
}
