"use client";

import { useState, useCallback, useRef } from "react";
import type { Scene } from "@/app/lib/scenes";
import { toast } from "@/app/lib/use-toast";
import {
  generateRandomScene,
  mutateScene,
  DEFAULT_FUZZ_CONFIG,
  type FuzzConfig,
  type PatternPool,
  type ColorMode,
} from "@/app/lib/scene-fuzzer";

interface SceneFuzzerProps {
  onApplyScene: (scene: Scene) => void;
  onSaveScene: (name: string, values: Record<string, number>) => void;
  currentValues: Record<string, number>;
}

const POOL_OPTIONS: { label: string; value: PatternPool }[] = [
  { label: "All", value: "all" },
  { label: "Beams 0-84", value: "beams-low" },
  { label: "Beams 85-169", value: "beams-mid" },
  { label: "Beams 170-255", value: "beams-high" },
  { label: "Animations", value: "animations" },
];

const COLOR_OPTIONS: { label: string; value: ColorMode }[] = [
  { label: "Any", value: "any" },
  { label: "Warm", value: "warm" },
  { label: "Cool", value: "cool" },
  { label: "Cycling", value: "cycling" },
];

export default function SceneFuzzer({
  onApplyScene,
  onSaveScene,
  currentValues,
}: SceneFuzzerProps) {
  const [config, setConfig] = useState<FuzzConfig>(DEFAULT_FUZZ_CONFIG);
  const [lastScene, setLastScene] = useState<Scene | null>(null);
  const [history, setHistory] = useState<Scene[]>([]);
  const [namingScene, setNamingScene] = useState<Scene | null>(null);
  const [nameInput, setNameInput] = useState("");

  const historyRef = useRef(history);
  historyRef.current = history;

  const handleRandomize = useCallback(() => {
    const scene = generateRandomScene(config);
    setLastScene(scene);
    setHistory((prev) => [...prev.slice(-19), scene]);
    onApplyScene(scene);
  }, [config, onApplyScene]);

  const handleMutate = useCallback(() => {
    const base = lastScene ?? {
      name: "CURRENT",
      description: "",
      values: { ...currentValues },
    };
    const scene = mutateScene(base, config.effectIntensity);
    setLastScene(scene);
    setHistory((prev) => [...prev.slice(-19), scene]);
    onApplyScene(scene);
  }, [lastScene, currentValues, config.effectIntensity, onApplyScene]);

  const handleHistorySelect = useCallback(
    (scene: Scene) => {
      setLastScene(scene);
      onApplyScene(scene);
    },
    [onApplyScene]
  );

  const handleSave = useCallback((scene: Scene) => {
    setNamingScene(scene);
    setNameInput(scene.name);
  }, []);

  const confirmSave = useCallback(() => {
    if (!namingScene || !nameInput.trim()) return;
    onSaveScene(nameInput.trim(), namingScene.values);
    setNamingScene(null);
    setNameInput("");
  }, [namingScene, nameInput, onSaveScene]);

  const cancelNaming = useCallback(() => {
    setNamingScene(null);
    setNameInput("");
  }, []);

  return (
    <div className="space-y-5">
      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleRandomize}
          className="min-h-11 rounded-lg bg-accent-muted px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25"
        >
          Randomize
        </button>
        <button
          onClick={handleMutate}
          className="min-h-11 rounded-lg border border-accent/50 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
        >
          Mutate
        </button>
        {lastScene && (
          <>
            <button
              onClick={() => handleSave(lastScene)}
              className="min-h-11 rounded-lg border border-success/50 px-4 py-2 text-sm font-medium text-success transition-colors hover:bg-success/10"
            >
              Save
            </button>
            <span className="text-sm text-text-muted">
              {lastScene.name}
            </span>
          </>
        )}
      </div>

      {/* Naming prompt */}
      {namingScene && (
        <div className="flex gap-2">
          <input
            autoFocus
            type="text"
            placeholder="Scene name..."
            value={nameInput}
            aria-label="Scene name"
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmSave();
              if (e.key === "Escape") cancelNaming();
            }}
            className="min-h-11 flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-success"
          />
          <button
            onClick={confirmSave}
            disabled={!nameInput.trim()}
            className="min-h-11 rounded-lg bg-success/20 px-4 py-2 text-sm font-medium text-success transition-colors hover:bg-success/30 disabled:opacity-30"
          >
            Save
          </button>
          <button
            onClick={cancelNaming}
            className="min-h-11 rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:text-text-secondary"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Configuration */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div
            role="radiogroup"
            aria-label="Pattern pool"
          >
            <span className="mb-2 block text-sm text-text-secondary">
              Pattern Pool
            </span>
            <div className="flex flex-wrap gap-2">
              {POOL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  role="radio"
                  aria-checked={config.patternPool === opt.value}
                  onClick={() =>
                    setConfig((c) => ({ ...c, patternPool: opt.value }))
                  }
                  className={`min-h-9 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    config.patternPool === opt.value
                      ? "border-accent/50 bg-accent-muted text-accent"
                      : "border-border text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div
            role="radiogroup"
            aria-label="Color mode"
          >
            <span className="mb-2 block text-sm text-text-secondary">
              Color Mode
            </span>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  role="radio"
                  aria-checked={config.colorMode === opt.value}
                  onClick={() =>
                    setConfig((c) => ({ ...c, colorMode: opt.value }))
                  }
                  className={`min-h-9 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    config.colorMode === opt.value
                      ? "border-accent/50 bg-accent-muted text-accent"
                      : "border-border text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sliders */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 flex items-center justify-between text-sm text-text-secondary">
            <span>Effect Intensity</span>
            <span className="font-mono text-text-muted">
              {Math.round(config.effectIntensity * 100)}%
            </span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.effectIntensity}
            aria-label="Effect intensity"
            aria-valuetext={`${Math.round(config.effectIntensity * 100)}%`}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                effectIntensity: Number(e.target.value),
              }))
            }
            className="w-full"
          />
        </div>
        <div>
          <label className="mb-1 flex items-center justify-between text-sm text-text-secondary">
            <span>Movement</span>
            <span className="font-mono text-text-muted">
              {Math.round(config.movementIntensity * 100)}%
            </span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.movementIntensity}
            aria-label="Movement intensity"
            aria-valuetext={`${Math.round(config.movementIntensity * 100)}%`}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                movementIntensity: Number(e.target.value),
              }))
            }
            className="w-full"
          />
        </div>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div>
          <span className="mb-2 block text-sm text-text-secondary">
            Recent ({history.length})
          </span>
          <div className="flex flex-wrap gap-2">
            {history
              .slice()
              .reverse()
              .slice(0, 10)
              .map((scene, i) => (
                <span key={`${scene.name}-${i}`} className="inline-flex">
                  <button
                    onClick={() => handleHistorySelect(scene)}
                    className={`min-h-9 rounded-l-lg border px-3 py-1.5 text-xs transition-colors ${
                      lastScene?.name === scene.name
                        ? "border-success/50 bg-success/10 text-success"
                        : "border-border text-text-muted hover:text-text-secondary"
                    }`}
                    title={scene.description}
                  >
                    {scene.name}
                  </button>
                  <button
                    onClick={() => handleSave(scene)}
                    aria-label={`Save ${scene.name}`}
                    className="min-h-9 rounded-r-lg border border-l-0 border-border px-2 py-1.5 text-xs text-text-muted transition-colors hover:bg-success/10 hover:text-success"
                  >
                    +
                  </button>
                </span>
              ))}
          </div>
        </div>
      )}

      <p className="text-xs text-text-muted">
        Saved scenes appear in the Scenes tab and are available in Show mode
      </p>
    </div>
  );
}
