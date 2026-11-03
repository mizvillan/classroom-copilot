import {
  BookOpen,
  LayoutDashboard,
  ListChecks,
  Settings,
} from "lucide-react";

import type { Tab } from "../types";

const ITEMS: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Home", icon: LayoutDashboard },
  { id: "assignments", label: "Work", icon: ListChecks },
  { id: "courses", label: "Courses", icon: BookOpen },
  { id: "settings", label: "Setup", icon: Settings },
];

type Props = {
  tab: Tab;
  onTab: (tab: Tab) => void;
  openCount: number;
};

export function MobileNav({ tab, onTab, openCount }: Props) {
  return (
    <nav className="mobile-nav" aria-label="Main">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={`mobile-nav-item${tab === item.id ? " is-active" : ""}`}
            onClick={() => onTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
          >
            <span className="mobile-nav-icon">
              <Icon size={19} strokeWidth={1.9} />
              {item.id === "assignments" && openCount > 0 ? (
                <i className="mobile-badge">{openCount > 9 ? "9+" : openCount}</i>
              ) : null}
            </span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
