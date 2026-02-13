"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { CHANNELS } from "@/app/lib/channels";
import { SCENES, type Scene } from "@/app/lib/scenes";
import { toast } from "@/app/lib/use-toast";
import ChannelGrid from "@/app/components/ChannelGrid";
import SceneLibrary from "@/app/components/SceneLibrary";
import ShowMode from "@/app/components/ShowMode";
import SceneFuzzer from "@/app/components/SceneFuzzer";
import BottomNav, { TabIcons } from "@/app/components/BottomNav";
import StatusBadge from "@/app/components/StatusBadge";
import PortList from "@/app/components/PortList";
import DriverProbe from "@/app/components/DriverProbe";
import DMXTestPanel from "@/app/components/DMXTestPanel";
import { autoStartTour, startTour } from "@/app/lib/use-tour";
import type { StatusResponse } from "@/app/lib/types";

function defaultChannels(): Record<string, number> {
  const vals: Record<string, number> = {};
  for (const ch of CHANNELS) {
    vals[ch.key] = 0;
  }
  vals.laserOnOff = 100;
  vals.groupSelect = 0;
  vals.zoom = 64;
  vals.patternSize = 30; // CROSS mode, visible size
  return vals;
}

const TABS = [
  { key: "scenes", label: "Scenes", icon: TabIcons.scenes },
  { key: "channels", label: "Channels", icon: TabIcons.channels },
  { key: "fuzzer", label: "Fuzzer", icon: TabIcons.fuzzer },
  { key: "show", label: "Show", icon: TabIcons.show },
  { key: "setup", label: "Setup", icon: TabIcons.setup },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function SimulatePage() {
  const [tab, setTab] = useState<TabKey>("scenes");
  const [channels, setChannels] = useState<Record<string, number>>(defaultChannels);
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const [blackout, setBlackout] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const [showActive, setShowActive] = useState(false);
  const [savedScenesList, setSavedScenesList] = useState<Scene[]>([]);
  const [channelNaming, setChannelNaming] = useState(false);
  const [channelNameInput, setChannelNameInput] = useState("");
  const sendTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Setup tab state
  const [selectedPort, setSelectedPort] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [connectedMethod, setConnectedMethod] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const data: StatusResponse = await res.json();
        setStatus(data);
        if (data.connected && !data.simulation) {
          setConnected(true);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Auto-launch tour on first visit
  useEffect(() => {
    const timer = setTimeout(() => autoStartTour(), 500);
    return () => clearTimeout(timer);
  }, []);

  const handleProbeSuccess = useCallback(
    (method: string) => {
      setConnectedMethod(method);
      setConnected(true);
      refreshStatus();
      toast.success("SoundSwitch connected");
    },
    [refreshStatus]
  );

  const handleChange = useCallback((key: string, value: number) => {
    setChannels((prev) => ({ ...prev, [key]: value }));
    setActiveScene(null);
  }, []);

  const handleSceneSelect = useCallback((scene: Scene) => {
    setChannels((prev) => {
      const next = { ...prev };
      for (const ch of CHANNELS) {
        next[ch.key] = 0;
      }
      next.laserOnOff = 100;
      next.groupSelect = 0;
      next.zoom = 64;
      next.patternSize = 30; // CROSS mode, visible size
      for (const [k, v] of Object.entries(scene.values)) {
        next[k] = v;
      }
      return next;
    });
    setActiveScene(scene.name);
    setBlackout(false);
  }, []);

  // Separate handler for manual scene selection (with toast)
  const handleManualSceneSelect = useCallback(
    (scene: Scene) => {
      handleSceneSelect(scene);
      toast.info(`Scene: ${scene.name}`);
    },
    [handleSceneSelect]
  );

  const handleBlackout = useCallback(() => {
    setBlackout((prev) => !prev);
  }, []);

  // Toast for blackout state changes (outside updater to avoid double-fire)
  const prevBlackout = useRef(blackout);
  useEffect(() => {
    if (blackout !== prevBlackout.current) {
      prevBlackout.current = blackout;
      if (blackout) {
        fetch("/api/dmx/blackout", { method: "POST" }).catch(() => {});
        toast.warning("BLACKOUT ON");
      } else {
        toast.info("Blackout off");
      }
    }
  }, [blackout]);

  const channelsRef = useRef(channels);
  const blackoutRef = useRef(blackout);
  channelsRef.current = channels;
  blackoutRef.current = blackout;

  const sendToHardware = useCallback(() => {
    const channelMap: Record<number, number> = {};
    for (const ch of CHANNELS) {
      channelMap[ch.ch] = blackoutRef.current ? 0 : (channelsRef.current[ch.key] ?? 0);
    }
    fetch("/api/dmx/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channels: channelMap }),
    }).catch(() => {});
  }, []);

  const toggleSend = useCallback(() => {
    if (sending) {
      if (sendTimer.current) clearInterval(sendTimer.current);
      sendTimer.current = null;
      setSending(false);
      toast.info("DMX send stopped");
    } else {
      sendToHardware();
      sendTimer.current = setInterval(sendToHardware, 33);
      setSending(true);
      toast.info("Sending DMX at 30Hz");
    }
  }, [sending, sendToHardware]);

  const handleShowActiveChange = useCallback(
    (active: boolean) => {
      setShowActive(active);
      if (active && connected && !sending) {
        sendToHardware();
        sendTimer.current = setInterval(sendToHardware, 33);
        setSending(true);
      }
    },
    [connected, sending, sendToHardware]
  );

  const handleSavedScenesChange = useCallback((scenes: Scene[]) => {
    setSavedScenesList(scenes);
  }, []);

  const handleSaveScene = useCallback(
    (name: string, values: Record<string, number>) => {
      const STORAGE_KEY = "laser-saved-scenes";
      try {
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        const entry = {
          id: crypto.randomUUID(),
          name: name.toUpperCase(),
          values: { ...values },
          savedAt: Date.now(),
        };
        const updated = [...existing, entry];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setSavedScenesList(
          updated.map((s: { name: string; values: Record<string, number> }) => ({
            name: s.name,
            description: "",
            values: s.values,
          }))
        );
        toast.success(`Saved: ${name.toUpperCase()}`);
      } catch {}
    },
    []
  );

  const allScenes = [...SCENES, ...savedScenesList];

  // Arrow key navigation for desktop tabs
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const keys = TABS.map((t) => t.key);
      const idx = keys.indexOf(tab);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setTab(keys[(idx + 1) % keys.length] as TabKey);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setTab(keys[(idx - 1 + keys.length) % keys.length] as TabKey);
      } else if (e.key === "Home") {
        e.preventDefault();
        setTab(keys[0] as TabKey);
      } else if (e.key === "End") {
        e.preventDefault();
        setTab(keys[keys.length - 1] as TabKey);
      }
    },
    [tab]
  );

  useEffect(() => {
    return () => {
      if (sendTimer.current) clearInterval(sendTimer.current);
    };
  }, []);

  return (
    <main className="mx-auto px-4 pb-20 pt-4 md:max-w-5xl md:pb-8 md:pt-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 data-tour="welcome" className="text-lg font-bold md:text-2xl">DMX Control</h1>
        <div className="flex items-center gap-2">
          <button
            data-tour="help-btn"
            onClick={() => startTour()}
            aria-label="Show tour"
            className="inline-flex items-center justify-center rounded-full border border-border p-1.5 text-text-muted transition-colors hover:bg-surface-3 hover:text-accent"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="6.5" />
              <path d="M6 6a2 2 0 1 1 2 2v1.5" />
              <circle cx="8" cy="12" r="0.5" fill="currentColor" />
            </svg>
          </button>
          <button
            data-tour="blackout-btn"
            onClick={handleBlackout}
            aria-pressed={blackout}
            aria-label={blackout ? "Disable blackout" : "Enable blackout"}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              blackout
                ? "border border-error/50 bg-error/20 text-error"
                : "border border-error/30 bg-error/10 text-error/80 hover:bg-error/20 hover:text-error"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${blackout ? "bg-error animate-pulse" : "bg-error/50"}`} aria-hidden="true" />
            Blackout
          </button>
          {connected && (
            <button
              onClick={toggleSend}
              aria-pressed={sending}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                sending
                  ? "border border-success/50 bg-success/20 text-success"
                  : "border border-success/30 bg-success/10 text-success/80 hover:bg-success/20 hover:text-success"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${sending ? "bg-success animate-pulse" : "bg-success/50"}`} aria-hidden="true" />
              {sending ? "Live" : "Send"}
            </button>
          )}
          <StatusBadge status={status} />
        </div>
      </div>

      {/* Desktop tab bar */}
      <div
        role="tablist"
        aria-label="Control sections"
        onKeyDown={handleTabKeyDown}
        className="mb-4 hidden border-b border-border md:flex"
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              id={`tab-${t.key}`}
              data-tour={`tab-${t.key}`}
              aria-selected={active}
              aria-controls={`panel-${t.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={`relative min-h-11 px-5 py-3 text-sm font-medium transition-colors ${
                active ? "text-accent" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <span className="flex items-center gap-1.5">
                {t.label}
                {t.key === "show" && showActive && (
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                )}
                {t.key === "setup" && connected && (
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
                )}
              </span>
              {active && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab panels — ShowMode stays mounted to preserve audio engine */}
      {tab === "scenes" && (
        <div role="tabpanel" id="panel-scenes" aria-labelledby="tab-scenes" tabIndex={0}>
          <SceneLibrary
            activeScene={activeScene}
            onSelect={handleManualSceneSelect}
            currentValues={channels}
            onScenesChange={handleSavedScenesChange}
          />
        </div>
      )}

      {tab === "channels" && (
        <div role="tabpanel" id="panel-channels" aria-labelledby="tab-channels" tabIndex={0}>
          <div className="mb-3 flex items-center gap-2">
            {!channelNaming ? (
              <button
                onClick={() => setChannelNaming(true)}
                disabled={showActive}
                className="min-h-11 rounded-lg border border-success/50 px-4 py-2 text-sm font-medium text-success transition-colors hover:bg-success/10 disabled:opacity-30"
              >
                + Save Current
              </button>
            ) : (
              <div className="flex flex-1 gap-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="Scene name..."
                  value={channelNameInput}
                  aria-label="New scene name"
                  onChange={(e) => setChannelNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && channelNameInput.trim()) {
                      handleSaveScene(channelNameInput.trim(), channels);
                      setChannelNaming(false);
                      setChannelNameInput("");
                    }
                    if (e.key === "Escape") {
                      setChannelNaming(false);
                      setChannelNameInput("");
                    }
                  }}
                  className="min-h-11 flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-success"
                />
                <button
                  onClick={() => {
                    if (!channelNameInput.trim()) return;
                    handleSaveScene(channelNameInput.trim(), channels);
                    setChannelNaming(false);
                    setChannelNameInput("");
                  }}
                  disabled={!channelNameInput.trim()}
                  className="min-h-11 rounded-lg bg-success/20 px-4 py-2 text-sm font-medium text-success transition-colors hover:bg-success/30 disabled:opacity-30"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setChannelNaming(false);
                    setChannelNameInput("");
                  }}
                  className="min-h-11 rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:text-text-secondary"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          <ChannelGrid
            values={channels}
            onChange={handleChange}
            disabled={showActive}
          />
        </div>
      )}

      {tab === "fuzzer" && (
        <div role="tabpanel" id="panel-fuzzer" aria-labelledby="tab-fuzzer" tabIndex={0}>
          <SceneFuzzer
            onApplyScene={handleManualSceneSelect}
            onSaveScene={handleSaveScene}
            currentValues={channels}
          />
        </div>
      )}

      {/* ShowMode always mounted, hidden when not active tab */}
      <div
        role="tabpanel"
        id="panel-show"
        aria-labelledby="tab-show"
        tabIndex={0}
        className={tab === "show" ? "" : "hidden"}
      >
        <ShowMode
          scenes={allScenes}
          onApplyScene={handleSceneSelect}
          onChannelOverride={handleChange}
          channels={channels}
          onShowActiveChange={handleShowActiveChange}
        />
      </div>

      {tab === "setup" && (
        <div role="tabpanel" id="panel-setup" aria-labelledby="tab-setup" tabIndex={0}>
          <div className="space-y-6">
            {connected && connectedMethod && (
              <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/10 p-3">
                <span className="h-2.5 w-2.5 rounded-full bg-success" />
                <div className="text-sm">
                  <span className="font-medium text-success">Connected</span>
                  <span className="ml-2 text-text-secondary">
                    via {connectedMethod}{selectedPort ? ` @ ${selectedPort}` : ""}
                  </span>
                </div>
              </div>
            )}

            {/* Step 1: Scan for serial ports (for serial adapters) */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-text-secondary">1</span>
                <h2 className="text-sm font-semibold">Scan for Ports</h2>
                <span className="text-xs text-text-muted">(optional for SoundSwitch)</span>
              </div>
              <PortList selectedPort={selectedPort} onSelectPort={setSelectedPort} />
            </div>

            {/* Step 2: Choose protocol and connect */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-text-secondary">2</span>
                <h2 className="text-sm font-semibold">Connect</h2>
              </div>
              <DriverProbe
                selectedPort={selectedPort}
                onProbeSuccess={handleProbeSuccess}
              />
            </div>

            {/* Step 3: Test DMX output */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  connected ? "bg-surface-3 text-text-secondary" : "bg-surface-3/50 text-text-muted/50"
                }`}>3</span>
                <h2 className={`text-sm font-semibold ${!connected ? "text-text-muted/50" : ""}`}>
                  Test Output
                </h2>
              </div>
              <DMXTestPanel
                connected={connected}
                connectedPort={selectedPort}
                connectedMethod={connectedMethod}
              />
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom nav */}
      <BottomNav
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon, tourId: `tab-${t.key}` }))}
        activeTab={tab}
        onTabChange={(key) => setTab(key as TabKey)}
        showActiveDot={showActive}
      />
    </main>
  );
}
