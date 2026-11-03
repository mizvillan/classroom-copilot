import {
  BookOpen,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  RefreshCw,
  Settings,
} from "lucide-react";

import type { Dashboard, Tab } from "../types";
import { initials, plural, relativeTime } from "../lib/format";
import { Brand } from "./Brand";

const NAV: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "assignments", label: "Assignments", icon: ListChecks },
  { id: "courses", label: "Courses", icon: BookOpen },
  { id: "settings", label: "Settings", icon: Settings },
];

type Props = {
  tab: Tab;
  onTab: (tab: Tab) => void;
  data: Dashboard;
  syncing: boolean;
  onSync: () => void;
  onConnect: () => void;
};

export function Sidebar({ tab, onTab, data, syncing, onSync, onConnect }: Props) {
  const openCount = data.stats.active;
  const profile = data.profile;
  const discord = data.discord;

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <Brand />
      </div>

      <nav className="side-nav" aria-label="Main">
        <p className="side-label">Workspace</p>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item${tab === item.id ? " is-active" : ""}`}
              onClick={() => onTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.id === "assignments" && openCount > 0 ? (
                <em className="nav-count">{openCount}</em>
              ) : null}
              {item.id === "settings" && !data.connected ? (
                <i className="nav-alert" aria-label="Setup needed" />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-spacer" />

      <div className="side-connections">
        <p className="side-label">Connections</p>
        <div className="connection">
          <span
            className={`connection-icon${data.connected ? " is-live" : ""}`}
            aria-hidden="true"
          >
            <GraduationCap size={15} />
          </span>
          <div className="connection-copy">
            <strong>{data.connected ? "Classroom" : "Sample data"}</strong>
            <span>
              {data.connected
                ? data.fetchedAt
                  ? `Synced ${relativeTime(data.fetchedAt)}`
                  : "Waiting for first sync"
                : "Not connected yet"}
            </span>
          </div>
          <i
            className={`status-dot ${data.connected ? "is-live" : "is-waiting"}`}
            aria-hidden="true"
          />
        </div>

        <div className="connection">
          <span
            className={`connection-icon${discord.ready ? " is-live" : ""}`}
            aria-hidden="true"
          >
            <MessageSquare size={15} />
          </span>
          <div className="connection-copy">
            <strong>Discord</strong>
            <span>
              {discord.ready
                ? discord.channelName
                  ? `Posting to #${discord.channelName}`
                  : "Bot is live"
                : discord.configured
                  ? "Bot offline"
                  : "Not set up"}
            </span>
          </div>
          <i
            className={`status-dot ${discord.ready ? "is-live" : "is-idle"}`}
            aria-hidden="true"
          />
        </div>

        {!data.connected ? (
          <button type="button" className="btn btn-primary btn-sm full" onClick={onConnect}>
            Connect Classroom
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm full"
            onClick={onSync}
            disabled={syncing}
          >
            <RefreshCw size={14} className={syncing ? "spin" : ""} />
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        )}

        <p className="side-footnote">
          {data.connected
            ? `${plural(data.stats.active, "open task")} right now`
            : "Connect Google to use your real work"}
        </p>
      </div>

      <button
        type="button"
        className="profile"
        onClick={() => onTab("settings")}
        title="Open settings"
      >
        {profile?.picture ? (
          <img src={profile.picture} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="profile-fallback">{initials(profile?.name)}</span>
        )}
        <span className="profile-copy">
          <strong>{profile?.name || "Local workspace"}</strong>
          <span>
            {profile?.email ||
              (data.connected
                ? `${data.courses.length} courses · local data`
                : "Sample data preview")}
          </span>
        </span>
        <Settings size={15} className="profile-gear" />
      </button>
    </aside>
  );
}
