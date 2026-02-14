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
import {
  generateRandomScene,
  DEFAULT_FUZZ_CONFIG,
  type PatternPool,
} from "@/app/lib/scene-fuzzer";
import { toast } from "@/app/lib/use-toast";
import Toggle from "./Toggle";
import ShowTimeline, { type TimelineEvent } from "./ShowTimeline";

type SceneSource = "playlist" | "generate";

const POOL_OPTIONS: { label: string; value: PatternPool }[] = [
  { label: "All", value: "all" },
  { label: "Beams 0-84", value: "beams-low" },
  { label: "Beams 85-169", value: "beams-mid" },
  { label: "Beams 170-255", value: "beams-high" },
  { label: "Animations", value: "animations" },
];

const LOCKABLE_CHANNELS = [
  { key: "boundary", label: "Boundary" },
  { key: "zoom", label: "Zoom" },
  { key: "rotation", label: "Rotation" },
  { key: "xMove", label: "Pan X" },
  { key: "yMove", label: "Pan Y" },
  { key: "xZoom", label: "X Dist" },
  { key: "yZoom", label: "Y Dist" },
  { key: "colorChange", label: "Color" },
  { key: "dots", label: "Dots" },
  { key: "drawing2", label: "Drawing" },
  { key: "twist", label: "Twist" },
  { key: "grating", label: "Grating" },
];

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

  // Scene source & pattern pool (Feature 3)
  const [sceneSource, setSceneSource] = useState<SceneSource>("playlist");
  const [patternPool, setPatternPool] = useState<PatternPool>("all");

  // Per-band gains & BPM multiplier (Feature 4)
  const [bassGain, setBassGain] = useState(1.0);
  const [midGain, setMidGain] = useState(1.0);
  const [trebleGain, setTrebleGain] = useState(1.0);
  const [bpmMultiplier, setBpmMultiplier] = useState(1);

  // Attack/Release (Feature 6)
  const [attack, setAttack] = useState(0.0);
  const [release, setRelease] = useState(0.5);

  // Channel locks (Feature 5)
  const [lockedChannels, setLockedChannels] = useState<Set<string>>(new Set());

  // Scene crossfade (Feature 7)
  const [crossfadeDuration, setCrossfadeDuration] = useState(0);

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
  const channelsRef = useRef(channels);
  const intensityRef = useRef(intensity);
  const styleRef = useRef(style);
  const colorLockRef = useRef(colorLock);
  const gratingEnabledRef = useRef(gratingEnabled);
  const sceneSourceRef = useRef(sceneSource);
  const patternPoolRef = useRef(patternPool);
  const bassGainRef = useRef(bassGain);
  const midGainRef = useRef(midGain);
  const trebleGainRef = useRef(trebleGain);
  const bpmMultiplierRef = useRef(bpmMultiplier);
  const attackRef = useRef(attack);
  const releaseRef = useRef(release);
  const lockedChannelsRef = useRef(lockedChannels);
  const crossfadeDurationRef = useRef(crossfadeDuration);
  const crossfadeRef = useRef<{
    from: Record<string, number>;
    to: Record<string, number>;
    startMs: number;
    durationMs: number;
  } | null>(null);

  activeRef.current = active;
  playlistRef.current = playlist;
  currentIndexRef.current = currentIndex;
  scenesRef.current = scenes;
  channelsRef.current = channels;
  intensityRef.current = intensity;
  styleRef.current = style;
  colorLockRef.current = colorLock;
  gratingEnabledRef.current = gratingEnabled;
  sceneSourceRef.current = sceneSource;
  patternPoolRef.current = patternPool;
  bassGainRef.current = bassGain;
  midGainRef.current = midGain;
  trebleGainRef.current = trebleGain;
  bpmMultiplierRef.current = bpmMultiplier;
  attackRef.current = attack;
  releaseRef.current = release;
  lockedChannelsRef.current = lockedChannels;
  crossfadeDurationRef.current = crossfadeDuration;

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

  // Channels that must snap (not interpolate) during crossfade.
  // Interpolating these crosses preset mode boundaries causing visual glitches.
  const CROSSFADE_SNAP_KEYS = new Set([
    "pattern", "groupSelect", "laserOnOff",
    "zoom", "rotation", "dots", "drawing2",
    "xMove", "yMove", "xZoom", "yZoom",
    "boundary",     // CH2: interpolating across CROSS/REENTRY/BLANK causes glitches
    "grating",      // CH17: interpolating between grating groups flashes patterns
    "colorChange",  // CH12: interpolating from static color to cycling sweeps modes
    "fixedColor",   // CH11: interpolating causes gradual color-per-dot change
  ]);

  // Apply scene with optional crossfade
  const applySceneWithTransition = useCallback((scene: Scene) => {
    const cfDur = crossfadeDurationRef.current;
    if (cfDur > 0) {
      crossfadeRef.current = {
        from: { ...channelsRef.current },
        to: scene.values,
        startMs: performance.now(),
        durationMs: cfDur,
      };
      // Snap mode-boundary channels immediately
      for (const key of CROSSFADE_SNAP_KEYS) {
        if (scene.values[key] !== undefined) {
          onChannelOverride(key, scene.values[key]);
        }
      }
    } else {
      onApplyScene(scene);
    }
  }, [onApplyScene, onChannelOverride]);

  // Advance to next scene in playlist (or generate a new one)
  const advanceScene = useCallback(() => {
    // Clear rotation bump window so effects can take over immediately
    rotationBumpUntil.current = 0;

    if (sceneSourceRef.current === "generate") {
      const scene = generateRandomScene({
        ...DEFAULT_FUZZ_CONFIG,
        patternPool: patternPoolRef.current,
      });
      applySceneWithTransition(scene);
      onSceneAdvanced(showStateRef.current);
      timelineEventsRef.current.push({
        time: performance.now(),
        type: "scene",
        label: scene.name,
      });
      return;
    }

    const pl = playlistRef.current;
    if (pl.length === 0) return;

    const nextIdx = (currentIndexRef.current + 1) % pl.length;
    setCurrentIndex(nextIdx);
    currentIndexRef.current = nextIdx;

    const sceneIdx = pl[nextIdx];
    const scene = scenesRef.current[sceneIdx];
    if (scene) {
      applySceneWithTransition(scene);
      onSceneAdvanced(showStateRef.current);
      timelineEventsRef.current.push({
        time: performance.now(),
        type: "scene",
        label: scene.name,
      });
    }
  }, [applySceneWithTransition]);

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
      bassEnergy: Math.min(1, eng.bassEnergy * bassGainRef.current),
      midEnergy: Math.min(1, eng.midEnergy * midGainRef.current),
      trebleEnergy: Math.min(1, eng.trebleEnergy * trebleGainRef.current),
      bpm: Math.round(eng.bpm * bpmMultiplierRef.current),
    };

    const config: ShowEffectsConfig = {
      intensity: intensityRef.current,
      style: styleRef.current,
      colorLock: colorLockRef.current,
      gratingEnabled: gratingEnabledRef.current,
      attack: attackRef.current,
      release: releaseRef.current,
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

    // Remove locked channels from overrides
    const locked = lockedChannelsRef.current;
    for (const key of locked) {
      delete overrides[key as keyof typeof overrides];
    }

    // Apply each override
    for (const [key, val] of Object.entries(overrides)) {
      if (val !== undefined) {
        onChannelOverride(key, val as number);
      }
    }

    // Process crossfade if active
    const cf = crossfadeRef.current;
    if (cf) {
      const elapsed = performance.now() - cf.startMs;
      const t = Math.min(1, elapsed / cf.durationMs);
      for (const [key, toVal] of Object.entries(cf.to)) {
        if (locked.has(key)) continue;
        if (CROSSFADE_SNAP_KEYS.has(key)) {
          onChannelOverride(key, toVal); // snap mode-boundary channels
        } else {
          const fromVal = cf.from[key] ?? 0;
          onChannelOverride(key, Math.round(fromVal + (toVal - fromVal) * t));
        }
      }
      if (t >= 1) crossfadeRef.current = null;
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

    // Need at least 2 scenes in playlist mode
    if (sceneSource === "playlist" && playlist.length < 2) return;

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
      onShowBeat(st, beatEnergy, relativeStrength, attackRef.current, releaseRef.current);

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

      const lck = lockedChannelsRef.current;

      // Pick rotation direction from beat phase (CW 192-223 or CCW 224-255)
      const rotDir = Math.sin(st.beatPhase * 0.21) > 0 ? 192 : 224;

      // ── STRONG beats (relativeStrength > 1.3): full treatment ──
      if (relativeStrength > 1.3) {
        // Color change with family drift
        if (!colorLockRef.current && !lck.has("colorChange")) {
          const color = pickBeatColor(st, beatEnergy);
          onChannelOverride("colorChange", color);
          timelineEventsRef.current.push({
            time: performance.now(),
            type: "color",
            label: String(color),
          });
        }

        // Full rotation bump — stays within CW or CCW mode (32-value range)
        if (!lck.has("rotation")) {
          const rotBump = rotDir + Math.round(st.punchLevel * 31);
          onChannelOverride("rotation", rotBump);
          const bumpDuration = 200 + Math.round(beatEnergy * 100);
          rotationBumpUntil.current = performance.now() + bumpDuration;
          if (rotationBumpTimer.current) clearTimeout(rotationBumpTimer.current);
          rotationBumpTimer.current = setTimeout(() => {}, bumpDuration);
        }

        // Zoom punch on strong beats (ZOOM IN 160-191)
        if (!lck.has("zoom")) {
          onChannelOverride("zoom", 160 + Math.round(beatEnergy * 31));
        }

        // Strong flash
        setBeatFlash(true);
        setTimeout(() => setBeatFlash(false), 200 + Math.round(beatEnergy * 50));

      // ── NORMAL beats (0.7-1.3): moderate response ──
      } else if (relativeStrength >= 0.7) {
        // Color change (standard drift)
        if (!colorLockRef.current && !lck.has("colorChange")) {
          const color = pickBeatColor(st, beatEnergy);
          onChannelOverride("colorChange", color);
          timelineEventsRef.current.push({
            time: performance.now(),
            type: "color",
            label: String(color),
          });
        }

        // Moderate rotation bump — stays within CW or CCW mode
        if (!lck.has("rotation")) {
          const rotBump = rotDir + Math.round(st.punchLevel * 23);
          onChannelOverride("rotation", rotBump);
          const bumpDuration = 150 + Math.round(beatEnergy * 100);
          rotationBumpUntil.current = performance.now() + bumpDuration;
          if (rotationBumpTimer.current) clearTimeout(rotationBumpTimer.current);
          rotationBumpTimer.current = setTimeout(() => {}, bumpDuration);
        }

        // Medium flash
        setBeatFlash(true);
        setTimeout(() => setBeatFlash(false), 100 + Math.round(beatEnergy * 100));

      // ── WEAK beats (< 0.7): subtle accent only ──
      } else {
        // Subtle rotation nudge — CW only for consistency
        if (!lck.has("rotation")) {
          const rotNudge = 192 + Math.round(st.punchLevel * 20);
          onChannelOverride("rotation", rotNudge);
          rotationBumpUntil.current = performance.now() + 100;
        }

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
    if (sceneSource === "generate") {
      const firstScene = generateRandomScene({
        ...DEFAULT_FUZZ_CONFIG,
        patternPool,
      });
      onApplyScene(firstScene);
    } else {
      const firstScene = scenes[playlist[0]];
      if (firstScene) onApplyScene(firstScene);
    }
  }, [
    active,
    sceneSource,
    patternPool,
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

  // Channel lock toggle
  const toggleLock = useCallback((key: string) => {
    setLockedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
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
              disabled={!active && sceneSource === "playlist" && playlist.length < 2}
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
                { label: "B", val: energy, gain: 3 * bassGain, color: "bg-error", ariaLabel: "Bass energy" },
                { label: "M", val: midEnergy, gain: 6 * midGain, color: "bg-success", ariaLabel: "Mid energy" },
                { label: "T", val: trebleEnergy, gain: 10 * trebleGain, color: "bg-accent", ariaLabel: "Treble energy" },
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
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-sm font-mono text-text-muted">
                  {Math.round((bpm > 300 ? bpm / 2 : bpm) * bpmMultiplier)} bpm
                </span>
                <div className="flex gap-0.5">
                  {([0.5, 1, 2] as const).map((mult) => (
                    <button
                      key={mult}
                      onClick={() => setBpmMultiplier(mult)}
                      className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                        bpmMultiplier === mult
                          ? "bg-accent/20 text-accent"
                          : "text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      {mult === 0.5 ? "/2" : mult === 2 ? "x2" : "x1"}
                    </button>
                  ))}
                </div>
              </div>
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
                  <input
                    type="number"
                    min={0.2}
                    max={2.0}
                    step={0.1}
                    value={sensitivity}
                    onChange={(e) => setSensitivity(Math.max(0.2, Math.min(2.0, Number(e.target.value))))}
                    className="w-14 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-right font-mono text-sm text-text-primary outline-none focus:border-accent"
                  />
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
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0.5}
                      max={5.0}
                      step={0.1}
                      value={Number((fallbackInterval / 1000).toFixed(1))}
                      onChange={(e) => setFallbackInterval(Math.max(500, Math.min(5000, Math.round(Number(e.target.value) * 1000))))}
                      className="w-14 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-right font-mono text-sm text-text-primary outline-none focus:border-accent"
                    />
                    <span className="font-mono text-xs">s</span>
                  </div>
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

            {/* Per-band gain */}
            <div className="grid grid-cols-3 gap-4 mt-3">
              <div>
                <label className="mb-1 flex items-center justify-between text-sm text-text-muted">
                  <span>Bass</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={3}
                      step={0.1}
                      value={bassGain}
                      onChange={(e) => setBassGain(Math.max(0, Math.min(3, Number(e.target.value))))}
                      className="w-14 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-right font-mono text-sm text-text-primary outline-none focus:border-accent"
                    />
                    <span className="font-mono text-xs">x</span>
                  </div>
                </label>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={bassGain}
                  onChange={(e) => setBassGain(Number(e.target.value))}
                  aria-label="Bass gain"
                  aria-valuetext={`${bassGain.toFixed(1)}x`}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center justify-between text-sm text-text-muted">
                  <span>Mids</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={3}
                      step={0.1}
                      value={midGain}
                      onChange={(e) => setMidGain(Math.max(0, Math.min(3, Number(e.target.value))))}
                      className="w-14 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-right font-mono text-sm text-text-primary outline-none focus:border-accent"
                    />
                    <span className="font-mono text-xs">x</span>
                  </div>
                </label>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={midGain}
                  onChange={(e) => setMidGain(Number(e.target.value))}
                  aria-label="Mid gain"
                  aria-valuetext={`${midGain.toFixed(1)}x`}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center justify-between text-sm text-text-muted">
                  <span>Treble</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={3}
                      step={0.1}
                      value={trebleGain}
                      onChange={(e) => setTrebleGain(Math.max(0, Math.min(3, Number(e.target.value))))}
                      className="w-14 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-right font-mono text-sm text-text-primary outline-none focus:border-accent"
                    />
                    <span className="font-mono text-xs">x</span>
                  </div>
                </label>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={trebleGain}
                  onChange={(e) => setTrebleGain(Number(e.target.value))}
                  aria-label="Treble gain"
                  aria-valuetext={`${trebleGain.toFixed(1)}x`}
                  className="w-full"
                />
              </div>
            </div>

            {/* Attack / Release / Crossfade */}
            <div className="grid grid-cols-3 gap-4 mt-3">
              <div>
                <label className="mb-1 flex items-center justify-between text-sm text-text-muted">
                  <span>Attack</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(attack * 100)}
                      onChange={(e) => setAttack(Math.max(0, Math.min(1, Number(e.target.value) / 100)))}
                      className="w-14 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-right font-mono text-sm text-text-primary outline-none focus:border-accent"
                    />
                    <span className="font-mono text-xs">%</span>
                  </div>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={attack}
                  onChange={(e) => setAttack(Number(e.target.value))}
                  aria-label="Attack"
                  aria-valuetext={`${Math.round(attack * 100)}%`}
                  className="w-full"
                />
                <p className="mt-0.5 text-[10px] text-text-muted">0% = punchy, 100% = smooth</p>
              </div>
              <div>
                <label className="mb-1 flex items-center justify-between text-sm text-text-muted">
                  <span>Release</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(release * 100)}
                      onChange={(e) => setRelease(Math.max(0, Math.min(1, Number(e.target.value) / 100)))}
                      className="w-14 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-right font-mono text-sm text-text-primary outline-none focus:border-accent"
                    />
                    <span className="font-mono text-xs">%</span>
                  </div>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={release}
                  onChange={(e) => setRelease(Number(e.target.value))}
                  aria-label="Release"
                  aria-valuetext={`${Math.round(release * 100)}%`}
                  className="w-full"
                />
                <p className="mt-0.5 text-[10px] text-text-muted">0% = staccato, 100% = lingering</p>
              </div>
              <div>
                <label className="mb-1 flex items-center justify-between text-sm text-text-muted">
                  <span>Crossfade</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={2000}
                      step={50}
                      value={crossfadeDuration}
                      onChange={(e) => setCrossfadeDuration(Math.max(0, Math.min(2000, Number(e.target.value))))}
                      className="w-16 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-right font-mono text-sm text-text-primary outline-none focus:border-accent"
                    />
                    <span className="font-mono text-xs">ms</span>
                  </div>
                </label>
                <input
                  type="range"
                  min={0}
                  max={2000}
                  step={50}
                  value={crossfadeDuration}
                  onChange={(e) => setCrossfadeDuration(Number(e.target.value))}
                  aria-label="Scene crossfade duration"
                  aria-valuetext={crossfadeDuration === 0 ? "snap" : `${(crossfadeDuration / 1000).toFixed(1)} seconds`}
                  className="w-full"
                />
                <p className="mt-0.5 text-[10px] text-text-muted">Scene transition time</p>
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
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(intensity * 100)}
                      onChange={(e) => setIntensity(Math.max(0, Math.min(1, Number(e.target.value) / 100)))}
                      className="w-14 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-right font-mono text-sm text-text-primary outline-none focus:border-accent"
                    />
                    <span className="font-mono text-xs">%</span>
                  </div>
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

            {/* Channel locks */}
            <div className="mt-3">
              <span className="mb-2 block text-xs text-text-muted">
                Channel Locks {lockedChannels.size > 0 && `(${lockedChannels.size})`}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {LOCKABLE_CHANNELS.map(({ key, label }) => {
                  const isLocked = lockedChannels.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleLock(key)}
                      className={`min-h-9 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                        isLocked
                          ? "border-warning/50 bg-warning/10 text-warning"
                          : "border-border text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      {isLocked ? "\u{1F512} " : ""}{label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-text-muted">
                Locked channels won&apos;t be modified by effects or beats
              </p>
            </div>
          </details>

          {/* Scenes disclosure */}
          <details open>
            <summary className="text-sm font-semibold text-text-secondary cursor-pointer min-h-11 flex items-center">
              Scenes
            </summary>

            <div className="mt-2 space-y-3">
              {/* Scene source toggle */}
              <div className="flex gap-1.5" role="radiogroup" aria-label="Scene source">
                {(["playlist", "generate"] as const).map((src) => (
                  <button
                    key={src}
                    onClick={() => setSceneSource(src)}
                    disabled={active}
                    role="radio"
                    aria-checked={sceneSource === src}
                    className={`min-h-11 rounded border px-3 py-2 text-xs transition-colors ${
                      sceneSource === src
                        ? "border-accent/50 bg-accent/10 text-accent"
                        : "border-border text-text-muted hover:text-text-secondary"
                    } disabled:opacity-50`}
                  >
                    {src === "playlist" ? "Playlist" : "Generate"}
                  </button>
                ))}
              </div>

              {/* Generate mode: pattern pool selector */}
              {sceneSource === "generate" && (
                <div>
                  <span className="mb-2 block text-xs text-text-muted">Pattern Pool</span>
                  <div className="flex flex-wrap gap-1.5">
                    {POOL_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setPatternPool(opt.value)}
                        disabled={active}
                        role="radio"
                        aria-checked={patternPool === opt.value}
                        className={`min-h-9 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                          patternPool === opt.value
                            ? "border-accent/50 bg-accent-muted text-accent"
                            : "border-border text-text-muted hover:text-text-secondary"
                        } disabled:opacity-50`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Playlist mode: scene selector */}
              {sceneSource === "playlist" && (
                <div>
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
