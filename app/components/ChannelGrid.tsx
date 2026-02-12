"use client";

import { useState, useMemo, useId } from "react";
import { CHANNELS, type ChannelDef } from "@/app/lib/channels";
import PresetButtons from "./PresetButtons";

interface ChannelGridProps {
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
  disabled?: boolean;
}

const GROUP_COLORS: Record<string, string> = {
  power: "border-l-error/50",
  pattern: "border-l-accent/50",
  color: "border-l-success/50",
  movement: "border-l-warning/50",
  distortion: "border-l-[#aa66ff]/50",
  effects: "border-l-[#ff66aa]/50",
  groupB: "border-l-text-muted/40",
};

function getActivePreset(ch: ChannelDef, value: number): string | null {
  if (!ch.presets) return null;
  for (const p of ch.presets) {
    if (value >= p.range[0] && value <= p.range[1]) return p.label;
  }
  return null;
}

export default function ChannelGrid({
  values,
  onChange,
  disabled,
}: ChannelGridProps) {
  const [search, setSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const searchId = useId();

  const filtered = useMemo(() => {
    if (!search.trim()) return CHANNELS;
    const q = search.toLowerCase();
    return CHANNELS.filter(
      (ch) =>
        ch.label.toLowerCase().includes(q) ||
        ch.key.toLowerCase().includes(q) ||
        ch.group.toLowerCase().includes(q) ||
        `ch${ch.ch}`.includes(q)
    );
  }, [search]);

  const items: (
    | { type: "cell"; ch: ChannelDef }
    | { type: "expanded"; ch: ChannelDef }
  )[] = [];

  for (const ch of filtered) {
    items.push({ type: "cell", ch });
    if (ch.key === expandedKey) {
      items.push({ type: "expanded", ch });
    }
  }

  return (
    <div className={disabled ? "pointer-events-none opacity-60" : ""}>
      {/* Search */}
      <div className="mb-3">
        <label htmlFor={searchId} className="sr-only">
          Search DMX channels
        </label>
        <input
          id={searchId}
          type="text"
          placeholder="Search channels..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search DMX channels"
          className="min-h-11 w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
        />
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => {
          if (item.type === "expanded") {
            return (
              <ExpandedChannel
                key={`exp-${item.ch.key}`}
                ch={item.ch}
                value={values[item.ch.key] ?? 0}
                onChange={(v) => onChange(item.ch.key, v)}
                onClose={() => setExpandedKey(null)}
              />
            );
          }

          const ch = item.ch;
          const value = values[ch.key] ?? 0;
          const preset = getActivePreset(ch, value);
          const isExpanded = expandedKey === ch.key;

          return (
            <button
              key={ch.key}
              onClick={() => setExpandedKey(isExpanded ? null : ch.key)}
              aria-label={`CH${ch.ch} ${ch.label}, value ${value}${preset ? `, ${preset}` : ""}`}
              aria-expanded={isExpanded}
              className={`min-h-[56px] rounded-lg border border-border border-l-2 ${
                GROUP_COLORS[ch.group] ?? "border-l-border"
              } bg-surface-2 p-3 text-left transition-colors hover:border-accent/30 ${
                isExpanded ? "ring-1 ring-accent/50" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">
                  CH{ch.ch}
                </span>
                <span className="font-mono text-sm text-text-secondary">
                  {value}
                </span>
              </div>
              <div className="mt-0.5 truncate text-sm font-medium text-text-primary">
                {ch.label}
              </div>
              {preset && (
                <div className="mt-1">
                  <span className="rounded bg-accent-muted px-1.5 py-0.5 text-xs text-accent">
                    {preset}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="mt-4 text-center text-sm text-text-muted">
          No channels match &quot;{search}&quot;
        </p>
      )}
    </div>
  );
}

// ── Expanded channel detail ──

function ExpandedChannel({
  ch,
  value,
  onChange,
  onClose,
}: {
  ch: ChannelDef;
  value: number;
  onChange: (v: number) => void;
  onClose: () => void;
}) {
  const sliderId = useId();

  return (
    <div
      role="region"
      aria-label={`CH${ch.ch} ${ch.label} controls`}
      className="col-span-full rounded-lg border border-accent/30 bg-surface-2 p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <label htmlFor={sliderId} className="text-sm font-semibold text-text-primary">
          CH{ch.ch} {ch.label}
        </label>
        <button
          onClick={onClose}
          aria-label="Close channel detail"
          className="min-h-9 rounded-lg px-3 py-1.5 text-sm text-text-muted hover:bg-surface-3 hover:text-text-secondary"
        >
          Close
        </button>
      </div>

      {/* Slider + numeric input */}
      <div className="flex items-center gap-3">
        <input
          id={sliderId}
          type="range"
          min={ch.min}
          max={ch.max}
          value={value}
          aria-valuemin={ch.min}
          aria-valuemax={ch.max}
          aria-valuenow={value}
          aria-valuetext={`${ch.label}: ${value}`}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1"
        />
        <input
          type="number"
          min={ch.min}
          max={ch.max}
          value={value}
          aria-label={`${ch.label} value`}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!isNaN(v)) onChange(Math.max(ch.min, Math.min(ch.max, v)));
          }}
          className="min-h-11 w-16 rounded-lg border border-border bg-surface-1 px-2 py-2 text-center font-mono text-sm text-text-primary outline-none focus:border-accent"
        />
      </div>

      {/* Presets */}
      {ch.presets && (
        <PresetButtons
          presets={ch.presets}
          value={value}
          onChange={onChange}
          label={`${ch.label} presets`}
        />
      )}
    </div>
  );
}
