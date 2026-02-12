"use client";

interface Preset {
  label: string;
  range: [number, number];
}

interface PresetButtonsProps {
  presets: Preset[];
  value: number;
  onChange: (value: number) => void;
  label?: string;
}

export default function PresetButtons({
  presets,
  value,
  onChange,
  label,
}: PresetButtonsProps) {
  return (
    <div
      role="radiogroup"
      aria-label={label ?? "Presets"}
      className="flex flex-wrap gap-2"
    >
      {presets.map((p) => {
        const active = value >= p.range[0] && value <= p.range[1];
        const midpoint = Math.round((p.range[0] + p.range[1]) / 2);
        return (
          <button
            key={p.label}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(midpoint)}
            className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-accent bg-accent-muted text-accent"
                : "border-border text-text-secondary hover:border-accent/50 hover:text-text-primary"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
