"use client";

import { useState, useEffect, useCallback } from "react";
import { SCENES, type Scene } from "@/app/lib/scenes";
import { toast } from "@/app/lib/use-toast";

const STORAGE_KEY = "laser-saved-scenes";

interface SavedScene {
  id: string;
  name: string;
  values: Record<string, number>;
  savedAt: number;
}

function loadSaved(): SavedScene[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistSaved(scenes: SavedScene[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenes));
}

interface SceneLibraryProps {
  activeScene: string | null;
  onSelect: (scene: Scene) => void;
  currentValues: Record<string, number>;
  onScenesChange?: (scenes: Scene[]) => void;
}

export default function SceneLibrary({
  activeScene,
  onSelect,
  currentValues,
  onScenesChange,
}: SceneLibraryProps) {
  const [saved, setSaved] = useState<SavedScene[]>([]);
  const [naming, setNaming] = useState(false);
  const [nameInput, setNameInput] = useState("");

  useEffect(() => {
    const loaded = loadSaved();
    setSaved(loaded);
    onScenesChange?.(
      loaded.map((s) => ({ name: s.name, description: "", values: s.values }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = useCallback(() => {
    if (!nameInput.trim()) return;
    const scene: SavedScene = {
      id: crypto.randomUUID(),
      name: nameInput.trim().toUpperCase(),
      values: { ...currentValues },
      savedAt: Date.now(),
    };
    const updated = [...saved, scene];
    setSaved(updated);
    persistSaved(updated);
    onScenesChange?.(
      updated.map((s) => ({ name: s.name, description: "", values: s.values }))
    );
    toast.success(`Saved: ${scene.name}`);
    setNaming(false);
    setNameInput("");
  }, [nameInput, currentValues, saved, onScenesChange]);

  const handleDelete = useCallback(
    (id: string, name: string) => {
      const updated = saved.filter((s) => s.id !== id);
      setSaved(updated);
      persistSaved(updated);
      onScenesChange?.(
        updated.map((s) => ({
          name: s.name,
          description: "",
          values: s.values,
        }))
      );
      toast.info(`Deleted: ${name}`);
    },
    [saved, onScenesChange]
  );

  return (
    <div className="space-y-4">
      {/* Save button / name input */}
      <div className="flex items-center gap-2">
        {!naming ? (
          <button
            onClick={() => setNaming(true)}
            className="min-h-11 rounded-lg border border-success/50 px-4 py-2 text-sm font-medium text-success transition-colors hover:bg-success/10"
          >
            + Save Current
          </button>
        ) : (
          <div className="flex flex-1 gap-2">
            <input
              autoFocus
              type="text"
              placeholder="Scene name..."
              value={nameInput}
              aria-label="New scene name"
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") {
                  setNaming(false);
                  setNameInput("");
                }
              }}
              className="min-h-11 flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-success"
            />
            <button
              onClick={handleSave}
              disabled={!nameInput.trim()}
              className="min-h-11 rounded-lg bg-success/20 px-4 py-2 text-sm font-medium text-success transition-colors hover:bg-success/30 disabled:opacity-30"
            >
              Save
            </button>
            <button
              onClick={() => {
                setNaming(false);
                setNameInput("");
              }}
              className="min-h-11 rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:text-text-secondary"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Unified scene grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {/* Built-in presets */}
        {SCENES.map((scene) => {
          const active = activeScene === scene.name;
          return (
            <button
              key={scene.name}
              onClick={() => onSelect(scene)}
              aria-selected={active}
              className={`min-h-[64px] rounded-lg border p-3 text-left transition-all sm:p-4 ${
                active
                  ? "border-success bg-success/10 shadow-lg shadow-success/10"
                  : "border-border hover:border-accent/50 hover:bg-surface-2"
              }`}
            >
              <div className="text-sm font-semibold">{scene.name}</div>
              <div className="mt-0.5 text-xs text-text-secondary">
                {scene.description}
              </div>
              <div className="mt-1.5">
                <span className="rounded bg-surface-3 px-1.5 py-0.5 text-xs text-text-muted">
                  preset
                </span>
              </div>
            </button>
          );
        })}

        {/* Saved scenes */}
        {saved.map((scene) => {
          const active = activeScene === scene.name;
          return (
            <div
              key={scene.id}
              className={`group relative min-h-[64px] rounded-lg border p-3 text-left transition-all sm:p-4 ${
                active
                  ? "border-success bg-success/10 shadow-lg shadow-success/10"
                  : "border-border hover:border-accent/50 hover:bg-surface-2"
              }`}
            >
              <button
                onClick={() =>
                  onSelect({
                    name: scene.name,
                    description: "",
                    values: scene.values,
                  })
                }
                aria-selected={active}
                className="block w-full text-left"
              >
                <div className="text-sm font-semibold">{scene.name}</div>
                <div className="mt-0.5 text-xs text-text-muted">
                  {new Date(scene.savedAt).toLocaleDateString()}
                </div>
                <div className="mt-1.5">
                  <span className="rounded bg-accent-muted px-1.5 py-0.5 text-xs text-accent">
                    saved
                  </span>
                </div>
              </button>
              <button
                onClick={() => handleDelete(scene.id, scene.name)}
                aria-label={`Delete scene ${scene.name}`}
                className="absolute right-2 top-2 rounded-lg p-1.5 text-sm text-text-muted transition-colors hover:bg-error/20 hover:text-error md:hidden md:group-hover:block"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {saved.length === 0 && (
        <p className="text-sm text-text-muted">
          Saved scenes appear alongside presets. Use the fuzzer or channel
          controls to create new scenes.
        </p>
      )}
    </div>
  );
}
