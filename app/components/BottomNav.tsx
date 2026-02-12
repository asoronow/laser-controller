"use client";

interface Tab {
  key: string;
  label: string;
  icon: React.ReactNode;
  tourId?: string;
}

interface BottomNavProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  showActiveDot?: boolean;
}

// Simple inline SVG icons
const Icons = {
  scenes: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="7" height="7" rx="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" />
    </svg>
  ),
  channels: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="4" y1="4" x2="4" y2="16" />
      <line x1="8" y1="7" x2="8" y2="16" />
      <line x1="12" y1="3" x2="12" y2="16" />
      <line x1="16" y1="9" x2="16" y2="16" />
      <circle cx="4" cy="4" r="1.5" fill="currentColor" />
      <circle cx="8" cy="7" r="1.5" fill="currentColor" />
      <circle cx="12" cy="3" r="1.5" fill="currentColor" />
      <circle cx="16" cy="9" r="1.5" fill="currentColor" />
    </svg>
  ),
  fuzzer: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2l2.5 5H17l-4 3.5 1.5 5.5-4.5-3-4.5 3 1.5-5.5L3 7h4.5z" />
    </svg>
  ),
  show: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="7,4 17,10 7,16" />
    </svg>
  ),
  setup: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.2 4.2l1.8 1.8M14 14l1.8 1.8M4.2 15.8l1.8-1.8M14 6l1.8-1.8" />
    </svg>
  ),
};

export { Icons as TabIcons };

export default function BottomNav({
  tabs,
  activeTab,
  onTabChange,
  showActiveDot,
}: BottomNavProps) {
  return (
    <nav
      role="tablist"
      aria-label="Navigation"
      className="fixed inset-x-0 bottom-0 z-50 flex h-16 items-stretch border-t border-border bg-surface-0/95 backdrop-blur-lg md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {tabs.map((t) => {
        const active = activeTab === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            data-tour={t.tourId}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onTabChange(t.key)}
            className={`flex flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors ${
              active ? "text-accent" : "text-text-muted"
            }`}
          >
            {t.icon}
            <span className="flex items-center gap-1">
              {t.label}
              {t.key === "show" && showActiveDot && (
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
