"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { SCENES, type Scene } from "@/app/lib/scenes";
import { AudioEngine } from "@/app/lib/audio-engine";
import {
  computeEffects,
  pickBeatColor,
  shouldAdvanceScene,
  onShowBeat,
  onSceneAdvanced,
  createShowState,
  type ShowStyle,
  type ShowState,
  type AudioState,
  type ShowEffectsConfig,
} from "@/app/lib/show-effects";
import { toast } from "@/app/lib/use-toast";
import Toggle from "./Toggle";
import ShowTimeline, { type TimelineEvent } from "./ShowTimeline";

const RECORDINGS_KEY = "laser-show-recordings";

interface RecordedFrame {
  time: number;
  values: Record<string, number>;
}

interface SavedRecording {
  id: string;
  name: string;
  frames: RecordedFrame[];
  duration: number;
  savedAt: number;
}

interface ShowModeProps {
  scenes: Scene[];
  onApplyScene: (scene: Scene) => void;
  onChannelOverride: (key: string, value: number) => void;
  channels: Record<string, number>;
  onShowActiveChange?: (active: boolean) => void;
}

function loadRecordings(): SavedRecording[] {
  try {
    return JSON.parse(localStorage.getItem(RECORDINGS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRecordings(recs: SavedRecording[]) {
  localStorage.setItem(RECORDINGS_KEY, JSON.stringify(recs));
}

export default function ShowMode({
  scenes,
  onApplyScene,
  onChannelOverride,
  channels,
  onShowActiveChange,
}: ShowModeProps) {
  const [active, setActive] = useState(false);
  const [energy, setEnergy] = useState(0);
  const [midEnergy, setMidEnergy] = useState(0);
  const [trebleEnergy, setTrebleEnergy] = useState(0);
  const [bpm, setBpm] = useState(0);
  const [sensitivity, setSensitivity] = useState(1.0);
  const [fallbackInterval, setFallbackInterval] = useState(2000);
  const [playlist, setPlaylist] = useState<number[]>(() =>
    SCENES.map((_, i) => i)
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [beatFlash, setBeatFlash] = useState(false);

  // Effects controls
  const [intensity, setIntensity] = useState(0.7);
  const [style, setStyle] = useState<ShowStyle>("sweep");
  const [colorLock, setColorLock] = useState(false);
  const [gratingEnabled, setGratingEnabled] = useState(true);

  // Recording
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const recordedFrames = useRef<RecordedFrame[]>([]);
  const recordStartTime = useRef(0);
  const playbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const engine = useRef<AudioEngine | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const rotationBumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const energyFrame = useRef<number | null>(null);
  const beatCountRef = useRef(0);
  const rotationBumpUntil = useRef(0);

  // Timeline event tracking
  const timelineEventsRef = useRef<TimelineEvent[]>([]);

  // Show effects state (mutable, persists across frames)
  const showStateRef = useRef<ShowState>(createShowState());

  // Refs to avoid stale closures in rAF / callbacks
  const activeRef = useRef(active);
  const playlistRef = useRef(playlist);
  const currentIndexRef = useRef(currentIndex);
  const scenesRef = useRef(scenes);
  const intensityRef = useRef(intensity);
  const styleRef = useRef(style);
  const colorLockRef = useRef(colorLock);
  const gratingEnabledRef = useRef(gratingEnabled);

  activeRef.current = active;
  playlistRef.current = playlist;
  currentIndexRef.current = currentIndex;
  scenesRef.current = scenes;
  intensityRef.current = intensity;
  styleRef.current = style;
  colorLockRef.current = colorLock;
  gratingEnabledRef.current = gratingEnabled;

  // When scenes list changes (e.g. saved scenes added), reset playlist to include all
  const prevSceneCountRef = useRef(scenes.length);
  useEffect(() => {
    if (scenes.length !== prevSceneCountRef.current) {
      prevSceneCountRef.current = scenes.length;
      if (!active) {
        setPlaylist(scenes.map((_, i) => i));
      }
    }
  }, [scenes, active]);

  // Load recordings on mount
  useEffect(() => {
    setRecordings(loadRecordings());
  }, []);

  // Advance to next scene in playlist
  const advanceScene = useCallback(() => {
    const pl = playlistRef.current;
    if (pl.length === 0) return;

    const nextIdx = (currentIndexRef.current + 1) % pl.length;
    setCurrentIndex(nextIdx);
    currentIndexRef.current = nextIdx;

    const sceneIdx = pl[nextIdx];
    const scene = scenesRef.current[sceneIdx];
    if (scene) {
      onApplyScene(scene);
      onSceneAdvanced(showStateRef.current);
      // Log timeline event
      timelineEventsRef.current.push({
        time: performance.now(),
        type: "scene",
        label: scene.name,
      });
    }
  }, [onApplyScene]);

  // Record channel snapshots
  useEffect(() => {
    if (recording && active) {
      const elapsed = performance.now() - recordStartTime.current;
      recordedFrames.current.push({
        time: elapsed,
        values: { ...channels },
      });
    }
  }, [channels, recording, active]);

  // Effects engine: runs every frame, computes channel overrides from audio + time
  const updateEffects = useCallback(() => {
    if (!activeRef.current || !engine.current) return;

    const eng = engine.current;
    setEnergy(eng.bassEnergy);
    setMidEnergy(eng.midEnergy);
    setTrebleEnergy(eng.trebleEnergy);
    setBpm(eng.bpm);

    const audio: AudioState = {
      bassEnergy: eng.bassEnergy,
      midEnergy: eng.midEnergy,
      trebleEnergy: eng.trebleEnergy,
      bpm: eng.bpm,
    };

    const config: ShowEffectsConfig = {
      intensity: intensityRef.current,
      style: styleRef.current,
      colorLock: colorLockRef.current,
      gratingEnabled: gratingEnabledRef.current,
    };

    // Get current scene's base values
    const pl = playlistRef.current;
    const sceneIdx = pl[currentIndexRef.current];
    const scene = scenesRef.current[sceneIdx];
    const sceneBase = scene?.values ?? {};

    const overrides = computeEffects(
      audio,
      config,
      sceneBase,
      performance.now(),
      showStateRef.current
    );

    // Don't override rotation during beat bump window
    if (performance.now() < rotationBumpUntil.current) {
      delete overrides.rotation;
    }

    // Apply each override
    for (const [key, val] of Object.entries(overrides)) {
      if (val !== undefined) {
        onChannelOverride(key, val as number);
      }
    }

    energyFrame.current = requestAnimationFrame(updateEffects);
  }, [onChannelOverride]);

  // Start/stop show mode
  const toggleShow = useCallback(async () => {
    if (active) {
      // Stop
      setActive(false);
      activeRef.current = false;
      onShowActiveChange?.(false);

      engine.current?.stop();
      if (fallbackTimer.current) clearInterval(fallbackTimer.current);
      if (energyFrame.current) cancelAnimationFrame(energyFrame.current);
      if (rotationBumpTimer.current) clearTimeout(rotationBumpTimer.current);
      fallbackTimer.current = null;
      energyFrame.current = null;
      beatCountRef.current = 0;
      timelineEventsRef.current = [];
      showStateRef.current = createShowState();
      toast.info("Show stopped");
      return;
    }

    // Need at least 2 scenes
    if (playlist.length < 2) return;

    // Start audio engine
    const eng = new AudioEngine();
    eng.sensitivity = sensitivity;
    engine.current = eng;

    try {
      await eng.start();
    } catch (err) {
      console.error("Mic access denied:", err);
      return;
    }

    // Beat callback — differentiated responses based on beat strength
    eng.onBeat((beatEnergy, _beatBpm, relativeStrength) => {
      if (!activeRef.current) return;

      const st = showStateRef.current;
      beatCountRef.current += 1;

      // Update show state with beat (includes phase advance + decay rate)
      onShowBeat(st, beatEnergy, relativeStrength);

      // Log beat event
      timelineEventsRef.current.push({
        time: performance.now(),
        type: "beat",
        label: "",
      });

      // Probabilistic scene advance (gated to strong beats inside)
      if (shouldAdvanceScene(st, beatEnergy, relativeStrength)) {
        advanceScene();
      }

      // ── STRONG beats (relativeStrength > 1.3): full treatment ──
      if (relativeStrength > 1.3) {
        // Color change with family drift
        if (!colorLockRef.current) {
          const color = pickBeatColor(st, beatEnergy);
          onChannelOverride("colorChange", color);
          timelineEventsRef.current.push({
            time: performance.now(),
            type: "color",
            label: String(color),
          });
        }

        // Full rotation bump
        const rotBump = 200 + Math.round(st.punchLevel * 55); // 200-255
        onChannelOverride("rotation", rotBump);
        const bumpDuration = 200 + Math.round(beatEnergy * 100); // 200-300ms
        rotationBumpUntil.current = performance.now() + bumpDuration;
        if (rotationBumpTimer.current) clearTimeout(rotationBumpTimer.current);
        rotationBumpTimer.current = setTimeout(() => {}, bumpDuration);

        // Zoom punch on strong beats
        onChannelOverride("zoom", 175 + Math.round(beatEnergy * 16));

        // Strong flash
        setBeatFlash(true);
        setTimeout(() => setBeatFlash(false), 200 + Math.round(beatEnergy * 50));

      // ── NORMAL beats (0.7-1.3): moderate response ──
      } else if (relativeStrength >= 0.7) {
        // Color change (standard drift)
        if (!colorLockRef.current) {
          const color = pickBeatColor(st, beatEnergy);
          onChannelOverride("colorChange", color);
          timelineEventsRef.current.push({
            time: performance.now(),
            type: "color",
            label: String(color),
          });
        }

        // Moderate rotation bump (200-230 range)
        const rotBump = 200 + Math.round(st.punchLevel * 30);
        onChannelOverride("rotation", rotBump);
        const bumpDuration = 150 + Math.round(beatEnergy * 100);
        rotationBumpUntil.current = performance.now() + bumpDuration;
        if (rotationBumpTimer.current) clearTimeout(rotationBumpTimer.current);
        rotationBumpTimer.current = setTimeout(() => {}, bumpDuration);

        // Medium flash
        setBeatFlash(true);
        setTimeout(() => setBeatFlash(false), 100 + Math.round(beatEnergy * 100));

      // ── WEAK beats (< 0.7): subtle accent only ──
      } else {
        // No color change — maintain continuity
        // Subtle rotation nudge
        const rotNudge = 195 + Math.round(st.punchLevel * 15);
        onChannelOverride("rotation", rotNudge);
        rotationBumpUntil.current = performance.now() + 100;

        // Brief flash
        setBeatFlash(true);
        setTimeout(() => setBeatFlash(false), 80);
      }

      // Reset fallback timer on any beat
      if (fallbackTimer.current) clearInterval(fallbackTimer.current);
      fallbackTimer.current = setInterval(advanceScene, fallbackInterval);
    });

    // Fallback timer (auto-advance when no beats)
    fallbackTimer.current = setInterval(advanceScene, fallbackInterval);

    // CRITICAL: Set activeRef BEFORE scheduling rAF so the first frame runs
    setActive(true);
    activeRef.current = true;
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    beatCountRef.current = 0;
    timelineEventsRef.current = [];
    showStateRef.current = createShowState();
    onShowActiveChange?.(true);
    toast.info("Show started");

    // Start effects animation loop
    energyFrame.current = requestAnimationFrame(updateEffects);

    // Apply first scene
    const firstScene = scenes[playlist[0]];
    if (firstScene) onApplyScene(firstScene);
  }, [
    active,
    playlist,
    sensitivity,
    fallbackInterval,
    scenes,
    advanceScene,
    updateEffects,
    onApplyScene,
    onChannelOverride,
    onShowActiveChange,
  ]);

  // Update sensitivity on engine when slider changes
  useEffect(() => {
    if (engine.current) {
      engine.current.sensitivity = sensitivity;
    }
  }, [sensitivity]);

  // Toggle scene in playlist
  const togglePlaylistScene = useCallback((idx: number) => {
    setPlaylist((prev) => {
      if (prev.includes(idx)) {
        return prev.filter((i) => i !== idx);
      }
      return [...prev, idx].sort((a, b) => a - b);
    });
  }, []);

  // Recording controls
  const startRecording = useCallback(() => {
    recordedFrames.current = [];
    recordStartTime.current = performance.now();
    setRecording(true);
    toast.info("Recording started");
  }, []);

  const stopRecording = useCallback(() => {
    setRecording(false);
    const frames = recordedFrames.current;
    if (frames.length < 2) return;

    const name = `Show ${new Date().toLocaleTimeString()}`;
    const rec: SavedRecording = {
      id: crypto.randomUUID(),
      name,
      frames,
      duration: frames[frames.length - 1].time,
      savedAt: Date.now(),
    };
    const updated = [...recordings, rec];
    setRecordings(updated);
    saveRecordings(updated);
    recordedFrames.current = [];
    toast.info("Recording saved");
  }, [recordings]);

  const playRecording = useCallback(
    (rec: SavedRecording) => {
      if (active) return; // don't play during live show
      setPlaying(true);

      let frameIdx = 0;
      const playNext = () => {
        if (frameIdx >= rec.frames.length) {
          setPlaying(false);
          return;
        }
        const frame = rec.frames[frameIdx];
        // Apply all channel values
        for (const [key, val] of Object.entries(frame.values)) {
          onChannelOverride(key, val);
        }

        frameIdx++;
        if (frameIdx < rec.frames.length) {
          const delay = rec.frames[frameIdx].time - frame.time;
          playbackTimer.current = setTimeout(playNext, delay);
        } else {
          setPlaying(false);
        }
      };

      playNext();
    },
    [active, onChannelOverride]
  );

  const stopPlayback = useCallback(() => {
    if (playbackTimer.current) clearTimeout(playbackTimer.current);
    playbackTimer.current = null;
    setPlaying(false);
  }, []);

  const deleteRecording = useCallback(
    (id: string) => {
      const updated = recordings.filter((r) => r.id !== id);
      setRecordings(updated);
      saveRecordings(updated);
    },
    [recordings]
  );

  // Cleanup
  useEffect(() => {
    return () => {
      engine.current?.stop();
      if (fallbackTimer.current) clearInterval(fallbackTimer.current);
      if (energyFrame.current) cancelAnimationFrame(energyFrame.current);
      if (rotationBumpTimer.current) clearTimeout(rotationBumpTimer.current);
      if (playbackTimer.current) clearTimeout(playbackTimer.current);
    };
  }, []);

  return (
    <div className="space-y-4">
          {/* Audio controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleShow}
              disabled={!active && playlist.length < 2}
              aria-pressed={active}
              className={`min-h-11 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-error/20 text-error hover:bg-error/30"
                  : "bg-success/20 text-success hover:bg-success/30 disabled:opacity-30"
              }`}
            >
              {active ? "Stop Show" : "Start Show"}
            </button>

            {/* Multi-band energy meter */}
            <div className="flex-1 space-y-1">
              {[
                { label: "B", val: energy, gain: 3, color: "bg-error", ariaLabel: "Bass energy" },
                { label: "M", val: midEnergy, gain: 6, color: "bg-success", ariaLabel: "Mid energy" },
                { label: "T", val: trebleEnergy, gain: 10, color: "bg-accent", ariaLabel: "Treble energy" },
              ].map(({ label, val, gain, color, ariaLabel }) => {
                const pct = Math.min(val * gain * 100, 100);
                return (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className="w-3 text-xs font-mono text-text-muted">
                      {label}
                    </span>
                    <div
                      className="h-3 flex-1 overflow-hidden rounded-full bg-surface-0"
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(pct)}
                      aria-label={ariaLabel}
                    >
                      <div
                        className={`h-full rounded-full transition-[width] duration-75 ${
                          beatFlash ? "bg-white" : color
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {bpm > 0 && (
              <span className="min-w-[4rem] text-right text-sm font-mono text-text-muted">
                {bpm > 300 ? Math.round(bpm / 2) : bpm} bpm
              </span>
            )}
          </div>

          {/* Timeline waveform */}
          <ShowTimeline
            engineRef={engine}
            active={active}
            eventsRef={timelineEventsRef}
          />

          {/* Audio Settings disclosure */}
          <details open>
            <summary className="text-sm font-semibold text-text-secondary cursor-pointer min-h-11 flex items-center">
              Audio Settings
            </summary>

            {/* Sensitivity + fallback speed */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
              <div>
                <label className="mb-1 flex items-center justify-between text-sm text-text-muted">
                  <span>Beat Sensitivity</span>
                  <span className="font-mono">{sensitivity.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min={0.2}
                  max={2.0}
                  step={0.1}
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                  aria-label="Beat Sensitivity"
                  aria-valuetext={`${sensitivity.toFixed(1)}`}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center justify-between text-sm text-text-muted">
                  <span>Scene Cycle</span>
                  <span className="font-mono">
                    {(fallbackInterval / 1000).toFixed(1)}s
                  </span>
                </label>
                <input
                  type="range"
                  min={500}
                  max={5000}
                  step={100}
                  value={fallbackInterval}
                  onChange={(e) => setFallbackInterval(Number(e.target.value))}
                  aria-label="Scene cycle interval"
                  aria-valuetext={`${(fallbackInterval / 1000).toFixed(1)} seconds`}
                  className="w-full"
                />
                <p className="mt-1 text-xs text-text-muted">Auto-advances scenes when no beats detected</p>
              </div>
            </div>
          </details>

          {/* Effects disclosure */}
          <details open>
            <summary className="text-sm font-semibold text-text-secondary cursor-pointer min-h-11 flex items-center">
              Effects
            </summary>

            {/* Effects controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
              <div>
                <label className="mb-1 flex items-center justify-between text-sm text-text-muted">
                  <span>Effect Intensity</span>
                  <span className="font-mono">
                    {Math.round(intensity * 100)}%
                  </span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={intensity}
                  onChange={(e) => setIntensity(Number(e.target.value))}
                  aria-label="Effect Intensity"
                  aria-valuetext={`${Math.round(intensity * 100)} percent`}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-text-muted">
                  Style
                </label>
                <div className="flex gap-1.5" role="radiogroup" aria-label="Show style">
                  {(["pulse", "sweep", "chaos"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStyle(s)}
                      role="radio"
                      aria-checked={style === s}
                      className={`min-h-11 rounded border px-3 py-2 text-xs transition-colors ${
                        style === s
                          ? "border-accent/50 bg-accent/10 text-accent"
                          : "border-border text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Toggles */}
            <div className="flex gap-6 mt-3">
              <div className="flex items-center gap-2">
                <Toggle
                  checked={colorLock}
                  onChange={setColorLock}
                  label="Lock Color"
                />
                <span className="text-sm text-text-muted">Lock Color</span>
              </div>
              <div className="flex items-center gap-2">
                <Toggle
                  checked={gratingEnabled}
                  onChange={setGratingEnabled}
                  label="Grating Effects"
                />
                <span className="text-sm text-text-muted">Grating Effects</span>
              </div>
            </div>
          </details>

          {/* Playlist disclosure */}
          <details open>
            <summary className="text-sm font-semibold text-text-secondary cursor-pointer min-h-11 flex items-center">
              Playlist ({playlist.length} scenes)
            </summary>

            <div className="mt-2">
              <div className="mb-2 flex items-center gap-2">
                <button
                  onClick={() => setPlaylist(scenes.map((_, i) => i))}
                  className="min-h-11 text-xs text-text-muted hover:text-text-secondary px-3 py-2"
                >
                  All
                </button>
                <button
                  onClick={() => setPlaylist([])}
                  className="min-h-11 text-xs text-text-muted hover:text-text-secondary px-3 py-2"
                >
                  None
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {scenes.map((scene, idx) => {
                  const included = playlist.includes(idx);
                  return (
                    <button
                      key={scene.name}
                      onClick={() => togglePlaylistScene(idx)}
                      disabled={active}
                      aria-selected={included}
                      className={`min-h-11 rounded border px-3 py-2 text-xs transition-colors ${
                        included
                          ? "border-accent/50 bg-accent/10 text-accent"
                          : "border-border text-text-muted hover:border-border hover:text-text-secondary"
                      } disabled:opacity-50`}
                    >
                      {scene.name}
                    </button>
                  );
                })}
              </div>
              {playlist.length < 2 && (
                <p className="mt-1 text-xs text-warning">
                  Select at least 2 scenes to start show mode
                </p>
              )}
            </div>
          </details>

          {/* Recording disclosure */}
          <details>
            <summary className="text-sm font-semibold text-text-secondary cursor-pointer min-h-11 flex items-center">
              Recording
            </summary>

            <div className="mt-2">
              <div className="mb-2 flex items-center gap-2">
                {active && !recording && !playing && (
                  <button
                    onClick={startRecording}
                    className="min-h-11 rounded border border-error/50 px-3 py-2 text-xs text-error hover:bg-error/10"
                  >
                    Record
                  </button>
                )}
                {recording && (
                  <button
                    onClick={stopRecording}
                    className="min-h-11 rounded bg-error/20 px-3 py-2 text-xs text-error animate-pulse"
                  >
                    Stop Recording ({recordedFrames.current.length} frames)
                  </button>
                )}
                {playing && (
                  <button
                    onClick={stopPlayback}
                    className="min-h-11 rounded bg-warning/20 px-3 py-2 text-xs text-warning"
                  >
                    Stop Playback
                  </button>
                )}
              </div>

              {recordings.length > 0 && (
                <div className="space-y-1">
                  {recordings.map((rec) => (
                    <div
                      key={rec.id}
                      className="group flex items-center justify-between rounded border border-border px-3 py-2"
                    >
                      <button
                        onClick={() => playRecording(rec)}
                        disabled={active || playing}
                        className="min-h-11 text-xs text-text-secondary hover:text-accent disabled:opacity-30"
                      >
                        {rec.name} ({(rec.duration / 1000).toFixed(0)}s,{" "}
                        {rec.frames.length} frames)
                      </button>
                      <button
                        onClick={() => deleteRecording(rec.id)}
                        className="hidden min-h-11 text-xs text-text-muted hover:text-error group-hover:block px-3 py-2"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {recordings.length === 0 && !recording && (
                <p className="text-xs text-text-muted">
                  Start a show, then hit Record to capture it.
                </p>
              )}
            </div>
          </details>
    </div>
  );
}
