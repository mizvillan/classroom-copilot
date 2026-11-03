import { ChevronRight, Plus, RefreshCw } from "lucide-react";

import type { Dashboard, Tab } from "../types";
import { relativeTime } from "../lib/format";
import { Brand } from "./Brand";

const LABEL: Record<Tab, string> = {
  overview: "Overview",
  assignments: "Assignments",
  courses: "Courses",
  settings: "Settings",
};

type Props = {
  tab: Tab;
  data: Dashboard;
  syncing: boolean;
  onSync: () => void;
  onConnect: () => void;
};

export function Topbar({ tab, data, syncing, onSync, onConnect }: Props) {
  return (
    <header className="topbar">
      <div className="topbar-mobile-brand">
        <Brand compact />
      </div>
      <div className="crumbs">
        <span>Classroom</span>
        <ChevronRight size={13} />
        <strong>{LABEL[tab]}</strong>
      </div>
      <div className="topbar-actions">
        <span className="sync-state">
          <i
            className={`status-dot ${
              data.connected ? "is-live" : "is-waiting"
            }`}
            aria-hidden="true"
          />
          {data.connected
            ? data.fetchedAt
              ? `Synced ${relativeTime(data.fetchedAt)}`
              : "Not synced yet"
            : "Sample data"}
        </span>
        {data.connected ? (
          <button
            type="button"
            className="icon-btn topbar-sync"
            onClick={onSync}
            disabled={syncing}
            aria-label="Sync Google Classroom"
            title="Sync Google Classroom"
          >
            <RefreshCw size={16} className={syncing ? "spin" : ""} />
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={onConnect}>
            <Plus size={14} />
            Get your work
          </button>
        )}
      </div>
    </header>
  );
}
