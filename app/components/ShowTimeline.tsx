"use client";

import { useRef, useEffect, useCallback } from "react";
import type { AudioEngine } from "@/app/lib/audio-engine";

export interface TimelineEvent {
  time: number;
  type: "beat" | "scene" | "color";
  label: string;
}

interface TimelinePoint {
  time: number;
  bass: number;
  mid: number;
  treble: number;
}

interface ShowTimelineProps {
  engineRef: React.RefObject<AudioEngine | null>;
  active: boolean;
  eventsRef: React.RefObject<TimelineEvent[]>;
}

const WINDOW_MS = 15_000;
// Gain factors to normalize visual levels (mid/treble are naturally quieter)
const BASS_GAIN = 1.0;
const MID_GAIN = 2.5;
const TREBLE_GAIN = 4.0;

export default function ShowTimeline({
  engineRef,
  active,
  eventsRef,
}: ShowTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<TimelinePoint[]>([]);
  const frameRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      frameRef.current = requestAnimationFrame(draw);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cw = Math.round(rect.width * dpr);
    const ch = Math.round(rect.height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      frameRef.current = requestAnimationFrame(draw);
      return;
    }

    const w = rect.width;
    const h = rect.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const now = performance.now();
    const eng = engineRef.current;

    // Sample current energy
    if (eng?.running) {
      dataRef.current.push({
        time: now,
        bass: eng.bassEnergy,
        mid: eng.midEnergy,
        treble: eng.trebleEnergy,
      });
    }

    // Trim old data
    const cutoff = now - WINDOW_MS;
    while (dataRef.current.length > 0 && dataRef.current[0].time < cutoff) {
      dataRef.current.shift();
    }

    const data = dataRef.current;
    const events = eventsRef.current ?? [];
    const windowStart = now - WINDOW_MS;

    if (data.length < 2) {
      // Draw placeholder grid
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      frameRef.current = requestAnimationFrame(draw);
      return;
    }

    // Draw energy bands as area fills
    const bands: Array<{
      key: "bass" | "mid" | "treble";
      fill: string;
      stroke: string;
      gain: number;
    }> = [
      {
        key: "bass",
        fill: "rgba(239, 68, 68, 0.25)",
        stroke: "rgba(239, 68, 68, 0.6)",
        gain: BASS_GAIN,
      },
      {
        key: "mid",
        fill: "rgba(34, 197, 94, 0.2)",
        stroke: "rgba(34, 197, 94, 0.5)",
        gain: MID_GAIN,
      },
      {
        key: "treble",
        fill: "rgba(59, 130, 246, 0.2)",
        stroke: "rgba(59, 130, 246, 0.5)",
        gain: TREBLE_GAIN,
      },
    ];

    for (const band of bands) {
      ctx.beginPath();
      let started = false;
      for (const pt of data) {
        const x = ((pt.time - windowStart) / WINDOW_MS) * w;
        const val = Math.min(pt[band.key] * band.gain, 1);
        const y = h - val * h * 0.9;
        if (!started) {
          ctx.moveTo(x, h);
          ctx.lineTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      // Close path to bottom
      const lastX =
        ((data[data.length - 1].time - windowStart) / WINDOW_MS) * w;
      ctx.lineTo(lastX, h);
      ctx.closePath();
      ctx.fillStyle = band.fill;
      ctx.fill();

      // Stroke the top edge
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = ((data[i].time - windowStart) / WINDOW_MS) * w;
        const val = Math.min(data[i][band.key] * band.gain, 1);
        const y = h - val * h * 0.9;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = band.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw events
    for (const evt of events) {
      if (evt.time < cutoff) continue;
      const x = ((evt.time - windowStart) / WINDOW_MS) * w;

      if (evt.type === "beat") {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        ctx.lineWidth = 1;
      } else if (evt.type === "scene") {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = "rgba(255, 200, 50, 0.2)";
        ctx.lineWidth = 1;
      }

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      // Label for scene changes
      if (evt.type === "scene") {
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.font = "9px ui-monospace, monospace";
        ctx.fillText(evt.label, x + 3, 11);
      }
    }

    // "Now" indicator line at right edge
    const nowX = ((now - windowStart) / WINDOW_MS) * w;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(nowX, 0);
    ctx.lineTo(nowX, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Band labels
    ctx.fillStyle = "rgba(239, 68, 68, 0.5)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText("BASS", 4, h - 4);
    ctx.fillStyle = "rgba(34, 197, 94, 0.5)";
    ctx.fillText("MID", 36, h - 4);
    ctx.fillStyle = "rgba(59, 130, 246, 0.5)";
    ctx.fillText("TRE", 62, h - 4);

    frameRef.current = requestAnimationFrame(draw);
  }, [engineRef, eventsRef]);

  useEffect(() => {
    if (!active) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }

    dataRef.current = [];
    frameRef.current = requestAnimationFrame(draw);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [active, draw]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Audio waveform timeline showing bass, mid, and treble energy"
      className="h-20 w-full rounded-lg border border-border bg-surface-1 sm:h-24"
    />
  );
}
