import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import {
  ApiError,
  disconnectGoogle,
  fetchDashboard,
  requestBriefing,
  sendDiscordTest,
  syncNow,
} from "./api";
import type { Dashboard, Tab } from "./types";
import { Assignments } from "./components/Assignments";
import { Brand } from "./components/Brand";
import { Courses } from "./components/Courses";
import { MobileNav } from "./components/MobileNav";
import { Overview } from "./components/Overview";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { Toast, type ToastMessage, type ToastTone } from "./components/Toast";
import { Topbar } from "./components/Topbar";

const TABS: Tab[] = ["overview", "assignments", "courses", "settings"];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  assignments: "Assignments",
  courses: "Courses",
  settings: "Settings",
};

function parseTab(): Tab {
  const raw = window.location.hash.replace(/^#/, "") as Tab;
  return TABS.includes(raw) ? raw : "overview";
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Check the server log.";
}

export default function App() {
  const [tab, setTab] = useState<Tab>(parseTab);
  const [data, setData] = useState<Dashboard | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [testingDiscord, setTestingDiscord] = useState(false);
  const [courseFilter, setCourseFilter] = useState("all");
  const toastTimer = useRef<number | null>(null);

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 5500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await fetchDashboard();
      setData(next);
      setBootError(null);
    } catch (error) {
      setBootError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeTab = useCallback((next: Tab) => {
    setTab(next);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${next}`,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const onHash = () => {
      setTab(parseTab());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.title =
      tab === "overview" ? "Classroom Copilot" : `${TAB_LABEL[tab]} · Classroom Copilot`;
  }, [tab]);

  // Pick up the ?google= result once, show it as a toast, and clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const google = params.get("google");
    if (!google) return;
    params.delete("google");
    const search = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
    );

    if (google === "connected") {
      notify("Google Classroom connected. Your real workload is loading now.", "success");
      void load();
    } else if (google === "denied") {
      notify("Google sign-in was cancelled. Nothing was changed.", "info");
    } else if (google === "not-configured") {
      notify("Add your Google OAuth credentials in Settings first.", "info");
      changeTab("settings");
    } else {
      notify("Google sign-in failed. Check the server log for the reason.", "error");
    }
  }, [changeTab, load, notify]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 120_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const handleConnect = useCallback(() => {
    if (data?.google?.configured) {
      // Full navigation: the server hands the browser to Google's consent
      // screen, then reroutes back here with the ?google= result — handled
      // by the effect above.
      window.location.href = "/api/auth/google";
      return;
    }
    changeTab("settings");
    notify(
      "No Google OAuth client in .env yet — paste your Classroom To-do text under “Get your work in” instead.",
      "info",
    );
  }, [changeTab, notify, data?.google?.configured]);

  const handleSync = async () => {
    if (!data?.connected) {
      handleConnect();
      return;
    }
    setSyncing(true);
    try {
      const result = await syncNow();
      const next = await fetchDashboard();
      setData(next);
      notify(
        result.newCount > 0
          ? `Synced. ${result.newCount} new ${result.newCount === 1 ? "item" : "items"} found.`
          : `Synced ${result.courses} ${result.courses === 1 ? "course" : "courses"}. Nothing new.`,
        "success",
      );
    } catch (error) {
      notify(errorMessage(error), "error");
      if (
        error instanceof ApiError &&
        ["needs_google", "needs_data_source", "google_auth_expired", "classroom_cookies_expired", "classroom_no_cookies"].includes(
          error.code,
        )
      ) {
        changeTab("settings");
      }
      void load();
    } finally {
      setSyncing(false);
    }
  };

  const handleGenerateBriefing = async () => {
    if (!data) return;
    setGenerating(true);
    try {
      const briefing = await requestBriefing({
        demo: data.source === "demo",
        force: true,
      });
      setData((current) => (current ? { ...current, briefing } : current));
      notify(
        briefing.source === "ai"
          ? "Briefing written by the model."
          : "Briefing refreshed with the priority engine.",
        "success",
      );
    } catch (error) {
      notify(errorMessage(error), "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleDisconnect = async () => {
    if (
      !window.confirm(
        "Disconnect Google Classroom and delete the local snapshot? You can reconnect at any time.",
      )
    ) {
      return;
    }
    setDisconnecting(true);
    try {
      await disconnectGoogle();
      const next = await fetchDashboard();
      setData(next);
      setCourseFilter("all");
      notify("Cleared. Sample data is back on screen.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleDiscordTest = async () => {
    setTestingDiscord(true);
    try {
      const result = await sendDiscordTest();
      notify(
        result.channel
          ? `Test message sent to #${result.channel}.`
          : "Test message sent to Discord.",
        "success",
      );
    } catch (error) {
      notify(errorMessage(error), "error");
    } finally {
      setTestingDiscord(false);
    }
  };

  if (!data) {
    return (
      <Boot
        error={bootError}
        onRetry={() => {
          setBootError(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className="app">
      <Sidebar
        tab={tab}
        onTab={changeTab}
        data={data}
        syncing={syncing}
        onSync={handleSync}
        onConnect={handleConnect}
      />

      <div className="main-column">
        <Topbar
          tab={tab}
          data={data}
          syncing={syncing}
          onSync={handleSync}
          onConnect={handleConnect}
        />
        <main className="main">
          <div className="view-wrap" key={tab}>
            {tab === "overview" ? (
              <Overview
                data={data}
                syncing={syncing}
                generating={generating}
                onSync={handleSync}
                onConnect={handleConnect}
                onTab={changeTab}
                onGenerateBriefing={handleGenerateBriefing}
              />
            ) : null}
            {tab === "assignments" ? (
              <Assignments
                data={data}
                courseFilter={courseFilter}
                onCourseFilter={setCourseFilter}
              />
            ) : null}
            {tab === "courses" ? (
              <Courses
                data={data}
                onSelectCourse={(courseId) => {
                  setCourseFilter(courseId);
                  changeTab("assignments");
                }}
              />
            ) : null}
            {tab === "settings" ? (
              <Settings
                data={data}
                syncing={syncing}
                disconnecting={disconnecting}
                testingDiscord={testingDiscord}
                onConnect={handleConnect}
                onSync={handleSync}
                onDisconnect={handleDisconnect}
                onTestDiscord={handleDiscordTest}
              />
            ) : null}
          </div>
        </main>
      </div>

      <MobileNav tab={tab} onTab={changeTab} openCount={data.stats.active} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

function Boot({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="boot">
      <div className="boot-card">
        <Brand />
        {error ? (
          <>
            <span className="boot-icon boot-icon-error">
              <AlertTriangle size={22} />
            </span>
            <h1>Can&apos;t reach the dashboard.</h1>
            <p>{error}</p>
            <button type="button" className="btn btn-primary" onClick={onRetry}>
              <RefreshCw size={15} />
              Try again
            </button>
            <p className="boot-hint">
              Start the app with <code>npm start</code> (or{" "}
              <code>npm run dev</code>) and keep this tab open.
            </p>
          </>
        ) : (
          <>
            <span className="boot-icon">
              <span className="boot-pulse" />
            </span>
            <h1>Reading Classroom…</h1>
            <p>Ranking deadlines, checking submissions and loading your briefing.</p>
          </>
        )}
      </div>
    </div>
  );
}
