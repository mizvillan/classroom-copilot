import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Bot,
  Check,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Cookie,
  GraduationCap,
  ListPlus,
  LogOut,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
} from "lucide-react";

import { applyImport, parseImport } from "../api";
import type { Dashboard, ImportDraft } from "../types";
import { relativeTime } from "../lib/format";

type Props = {
  data: Dashboard;
  syncing: boolean;
  disconnecting: boolean;
  testingDiscord: boolean;
  onConnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  onTestDiscord: () => void;
};

export function Settings({
  data,
  syncing,
  disconnecting,
  testingDiscord,
  onConnect,
  onSync,
  onDisconnect,
  onTestDiscord,
}: Props) {
  const { setup, discord } = data;
  const [paste, setPaste] = useState("");
  const [drafts, setDrafts] = useState<ImportDraft[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const parse = async () => {
    setParsing(true);
    setImportMsg(null);
    try {
      const result = await parseImport(paste);
      setDrafts(result.drafts);
      setImportMsg(
        result.drafts.length
          ? `Found ${result.drafts.length} item${result.drafts.length === 1 ? "" : "s"}. Check them below, then save.`
          : "Nothing recognisable in that text — paste the To-do page lines: title, course, due date.",
      );
    } catch (error) {
      setImportMsg(error instanceof Error ? error.message : "Parsing failed.");
    } finally {
      setParsing(false);
    }
  };

  const save = async () => {
    if (!drafts?.length) return;
    setApplying(true);
    setImportMsg(null);
    try {
      const result = await applyImport(drafts);
      setImportMsg(`Saved ${result.imported} items. They're in your workload now.`);
      setPaste("");
      setDrafts(null);
      onSync();
    } catch (error) {
      setImportMsg(error instanceof Error ? error.message : "Saving failed.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="view settings-view">
      <section className="page-head">
        <div>
          <p className="eyebrow">Wiring</p>
          <h1>Settings</h1>
          <p className="page-sub">
            Get your Classroom work in, put the bot in Discord, and install the
            app on your phone. Everything runs from this machine.
          </p>
        </div>
      </section>

      <section className="panel settings-card" id="google">
        <SettingsHead
          icon={<GraduationCap size={18} />}
          title="Google Classroom"
          subtitle="Sign in with Classroom itself for live sync of all your classes."
          status={
            data.source === "google" ? (
              <span className="pill pill-good">
                <Check size={12} /> Connected
              </span>
            ) : data.source === "import" ? (
              <span className="pill pill-warn">Paste-imported data</span>
            ) : (
              <span className="pill pill-quiet">Not connected</span>
            )
          }
        />

        {data.source === "google" && data.profile ? (
          <div className="account-row">
            {data.profile.picture ? (
              <img src={data.profile.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="account-avatar">
                <GraduationCap size={19} />
              </span>
            )}
            <div>
              <strong>{data.profile.name || "Classroom account"}</strong>
              <span>{data.profile.email || "Signed in via the Classroom API"}</span>
            </div>
            <span className="account-scope">api</span>
          </div>
        ) : null}

        {data.google?.configured ? (
          <>
            <p className="settings-lede">
              One click, and the app pulls every active class, coursework and
              submission state on a schedule. Connecting replaces any pasted
              rows with your live classes.
            </p>
            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onConnect}
                disabled={data.source === "google"}
              >
                <GraduationCap size={14} />
                {data.source === "google"
                  ? "Connected — syncing live"
                  : "Connect Google Classroom"}
              </button>
              {data.connected ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onSync}
                  disabled={syncing}
                >
                  <RefreshCw size={14} className={syncing ? "spin" : ""} />
                  Sync now
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <p className="settings-lede">
              No Google client configured yet. Paste your To-do page below —
              or add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>{" "}
              to <code>.env</code>, register this exact redirect URI in the
              Google Cloud wizard, and this button unlocks:
            </p>
            <CodeBlock lines={[data.google?.redirectUri || "http://localhost:8790/api/auth/google/callback"]} />
          </>
        )}
        {data.syncError ? <p className="inline-warning">{data.syncError}</p> : null}
      </section>

      <section className="panel settings-card" id="import">
        <SettingsHead
          icon={<ClipboardPaste size={18} />}
          title="Get your work in"
          subtitle="Paste your Classroom To-do text — no Google sign-in needed. Or let auto-sync read your open Classroom session."
          status={
            data.connected ? (
              <span className="pill pill-good">
                <Check size={12} /> {data.courses.length} course
                {data.courses.length === 1 ? "" : "s"} in
              </span>
            ) : (
              <span className="pill pill-quiet">Sample data</span>
            )
          }
        />

        {data.connected ? (
          <div className="facts facts-inline">
            <Fact label="Last update" value={relativeTime(data.fetchedAt)} />
            <Fact label="Assignments" value={String(data.stats.total)} />
            <Fact label="Auto-sync" value={setup.cookieSync ? `${setup.syncIntervalMinutes} min` : "Manual"} />
          </div>
        ) : null}

        {data.syncError ? <p className="inline-warning">{data.syncError}</p> : null}

        <div className="import-grid">
          <div className="import-paste">
            <label className="field-label" htmlFor="import-text">
              <span>1 · Paste from classroom.google.com/u/0/a/not-turned-in/all</span>
            </label>
            <textarea
              id="import-text"
              className="paste-box"
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              placeholder={
                "Select-all on your Classroom To-do page and copy it here, e.g.:\n\nAlgebra test chapters 1–3\nMathematics\nDue tomorrow · 20 points\n\nLab report draft\nChemistry\nDue Friday · 40 points"
              }
              rows={9}
              spellCheck={false}
            />
            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={parse}
                disabled={parsing || !paste.trim()}
              >
                <Sparkles size={14} />
                {parsing ? "Reading…" : "Read my list"}
              </button>
            </div>

            {drafts?.length ? (
              <>
                <div className="field-label draft-head">
                  <span>2 · Check the items ({drafts.length})</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setDrafts(null)}
                  >
                    Start over
                  </button>
                </div>
                <div className="draft-list">
                  {drafts.map((draft, index) => (
                    <DraftRow
                      key={`${draft.courseName}-${draft.title}-${index}`}
                      draft={draft}
                      onChange={(next) =>
                        setDrafts(
                          drafts.map((item, i) => (i === index ? next : item)),
                        )
                      }
                      onRemove={() =>
                        setDrafts(drafts.filter((_, i) => i !== index))
                      }
                    />
                  ))}
                </div>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={save}
                    disabled={applying}
                  >
                    <ListPlus size={14} />
                    {applying ? "Saving…" : `Save ${drafts.length} items`}
                  </button>
                </div>
              </>
            ) : null}

            {importMsg ? <p className="inline-warning">{importMsg}</p> : null}
          </div>

          <aside className="import-side">
            <div className="import-help">
              <Cookie size={15} />
              <strong>Want it automatic?</strong>
              <p>
                Copy your browser's Cookie header while a classroom.google.com
                tab is open (DevTools → Network → first request → Cookie) and
                save it in <code>.env</code>. The app then pulls your Assigned
                and Missing pages on a schedule — no Google API involved.
              </p>
            </div>
            <CodeBlock lines={["CLASSROOM_COOKIES=<paste the long cookie line here>"]} />
            {data.connected ? (
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onSync}
                  disabled={syncing}
                >
                  <RefreshCw size={14} className={syncing ? "spin" : ""} />
                  {setup.cookieSync ? "Sync from Classroom" : "Sync now"}
                </button>
              </div>
            ) : null}
          </aside>
        </div>
      </section>

      <section className="panel settings-card" id="discord">
        <SettingsHead
          icon={<MessageSquare size={18} />}
          title="Discord bot"
          subtitle="Scheduled digests, instant new-assignment alerts, and slash commands."
          status={
            discord.ready ? (
              <span className="pill pill-good">
                <Check size={12} /> Live
              </span>
            ) : discord.configured ? (
              <span className="pill pill-warn">Configured · offline</span>
            ) : (
              <span className="pill pill-quiet">Not set up</span>
            )
          }
        />

        {discord.ready ? (
          <>
            <div className="account-row discord-account">
              {discord.user?.avatar ? (
                <img src={discord.user.avatar} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="account-avatar">
                  <Bot size={19} />
                </span>
              )}
              <div>
                <strong>{discord.user?.tag || "Classroom Copilot bot"}</strong>
                <span>
                  {discord.channelName
                    ? `Posting in #${discord.channelName}`
                    : "Waiting for a channel"}
                </span>
              </div>
              <span className="account-scope">bot</span>
            </div>

            <div className="facts">
              <Fact label="Digest" value={discord.digestTime === "off" ? "Off" : discord.digestTime} />
              <Fact label="New alerts" value={discord.alerts ? "On" : "Off"} />
              <Fact
                label="Commands"
                value={discord.commandsRegistered ? "Registered" : "Pending"}
              />
              <Fact label="Channel" value={discord.channelName || "Not set"} />
            </div>

            {discord.error ? <p className="inline-warning">{discord.error}</p> : null}

            <div className="command-table">
              <Command name="/due" text="Everything due in the next 7 days" />
              <Command name="/next" text="The few assignments to do first" />
              <Command name="/brief" text="Full priority briefing" />
              <Command name="/sync" text="Pull Classroom right now" />
            </div>

            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onTestDiscord()}
                disabled={testingDiscord}
              >
                <Send size={14} />
                {testingDiscord ? "Sending…" : "Send test message"}
              </button>
              {discord.inviteUrl ? (
                <a
                  className="btn btn-ghost btn-sm"
                  href={discord.inviteUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Invite the bot
                  <ExternalLink size={13} />
                </a>
              ) : null}
            </div>
          </>
        ) : (
          <>
            {!discord.configured ? (
              <>
                <p className="settings-lede">
                  The bot runs inside this app. Create a Discord application,
                  copy its token, and invite it to your server.
                </p>
                <ol className="steps">
                  <SetupStep n="01" title="Create a bot application">
                    In the Discord Developer Portal, create a New Application,
                    then open Bot → Reset Token and copy the token.
                  </SetupStep>
                  <SetupStep n="02" title="Add the token and restart">
                    Put the token in <code>.env</code> as{" "}
                    <code>DISCORD_BOT_TOKEN</code>. After restart, an invite link
                    appears right here.
                  </SetupStep>
                  <SetupStep n="03" title="Invite it with commands">
                    Use the invite link with the <code>bot</code> and{" "}
                    <code>applications.commands</code> scopes, then pick a
                    private channel.
                  </SetupStep>
                  <SetupStep n="04" title="Copy the channel ID">
                    Enable Developer Mode in Discord, right-click the channel →
                    Copy Channel ID, and add it as{" "}
                    <code>DISCORD_CHANNEL_ID</code>.
                  </SetupStep>
                </ol>
                <div className="settings-actions">
                  <a
                    className="btn btn-ghost btn-sm"
                    href="https://discord.com/developers/applications"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Discord Developer Portal
                    <ExternalLink size={13} />
                  </a>
                </div>
                <CodeBlock
                  lines={[
                    "DISCORD_BOT_TOKEN=your-bot-token",
                    "DISCORD_CHANNEL_ID=your-channel-id",
                    "DISCORD_DIGEST_TIME=07:00",
                  ]}
                />
              </>
            ) : (
              <>
                <p className="settings-lede">
                  The token is loaded, but the bot isn&apos;t ready. Check the
                  channel ID and make sure the bot was invited to that server.
                </p>
                {discord.error ? (
                  <p className="inline-warning">{discord.error}</p>
                ) : null}
                <div className="command-table">
                  <Command name="/due" text="Everything due in the next 7 days" />
                  <Command name="/next" text="The few assignments to do first" />
                  <Command name="/brief" text="Full priority briefing" />
                  <Command name="/sync" text="Pull Classroom right now" />
                </div>
              </>
            )}
          </>
        )}
      </section>

      <section className="panel settings-card" id="ai">
        <SettingsHead
          icon={<Sparkles size={18} />}
          title="AI briefing & study kits"
          subtitle="The ranking is local and deterministic. The model writes the plan and the study material."
          status={
            setup.aiConfigured ? (
              <span className="pill pill-good">
                <Check size={12} /> AI on
              </span>
            ) : (
              <span className="pill pill-quiet">Local planner</span>
            )
          }
        />

        {setup.aiConfigured ? (
          <>
            <p className="settings-lede">
              Briefings and Study Kits run through a fallback chain — the lead
              model is <strong>{setup.aiModel}</strong>. If a provider is down or
              timing out, the next one answers, and the local planner catches
              anything left.
            </p>
            <div className="facts">
              <Fact label="Lead model" value={setup.aiModel} />
              <Fact label="Study Kits" value="Flashcards · quiz · slides · Q&A" />
              <Fact label="Cache" value="Per workload change" />
            </div>
            <p className="privacy-note">
              Sent to the model: course names, assignment titles, due dates,
              points and priority reasons. Never your cookies, tokens or files.
            </p>
          </>
        ) : (
          <>
            <p className="settings-lede">
              Add an AI key for written briefings and Study Kits. Ranking,
              counts and Discord alerts already work without one.
            </p>
            <CodeBlock
              lines={[
                "GROQ_API_KEY=your-groq-key",
                "AI_BASE_URL=https://api.groq.com/openai/v1",
              ]}
            />
            <div className="settings-actions">
              <a
                className="btn btn-ghost btn-sm"
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
              >
                Get a Groq key
                <ExternalLink size={13} />
              </a>
              <span className="settings-hint">
                Any OpenAI-compatible endpoint works via <code>AI_BASE_URL</code>.
              </span>
            </div>
          </>
        )}
      </section>

      <section className="panel settings-card" id="mobile">
        <SettingsHead
          icon={<Smartphone size={18} />}
          title="Phone & install"
          subtitle="Responsive on any phone. Installable as a PWA when served over HTTPS."
          status={<span className="pill pill-quiet">PWA</span>}
        />

        <p className="settings-lede">
          Keep this server running, connect to the same Wi-Fi, and open one of
          these addresses on your phone. On plain HTTP you can add it as a home
          screen shortcut; full offline install needs HTTPS.
        </p>

        {data.mobileUrls.length ? (
          <div className="url-list">
            {data.mobileUrls.map((url) => (
              <div className="url-row" key={url}>
                <code>{url}</code>
                <CopyButton value={url} />
              </div>
            ))}
          </div>
        ) : (
          <p className="inline-warning">
            No LAN address found. Make sure <code>HOST=0.0.0.0</code> in{" "}
            <code>.env</code> and restart the server.
          </p>
        )}

        <div className="install-grid">
          <div>
            <strong>iPhone / iPad</strong>
            <p>Safari → Share → Add to Home Screen.</p>
          </div>
          <div>
            <strong>Android</strong>
            <p>Chrome → ⋮ → Add to Home screen (HTTPS enables full install).</p>
          </div>
        </div>
      </section>

      <section className="panel settings-card" id="data">
        <SettingsHead
          icon={<ShieldCheck size={18} />}
          title="Data & privacy"
          subtitle="Everything is stored on this machine. Nothing is sent to a cloud database."
          status={<span className="pill pill-quiet">Local</span>}
        />
        <ul className="data-list">
          <li>
            <code>data/classroom.json</code>
            <span>Synced courses, assignments, briefing and study kits</span>
          </li>
          <li>
            <code>.env</code>
            <span>Keys, bot token and cookies — never committed to git</span>
          </li>
        </ul>
        <div className="settings-actions">
          {data.connected ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={onDisconnect}
              disabled={disconnecting}
            >
              <LogOut size={14} />
              {disconnecting ? "Clearing…" : "Clear data & reset"}
            </button>
          ) : (
            <span className="settings-hint">
              Import your work above to replace the sample data.
            </span>
          )}
          <span className="settings-version">Classroom Copilot v1.1.0</span>
        </div>
      </section>
    </div>
  );
}

function DraftRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: ImportDraft;
  onChange: (next: ImportDraft) => void;
  onRemove: () => void;
}) {
  const localValue = useMemo(() => {
    if (!draft.dueAt) return "";
    const date = new Date(draft.dueAt);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, [draft.dueAt]);

  return (
    <div className="draft-row">
      <div className="draft-main">
        <input
          className="draft-title"
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          aria-label="Assignment title"
        />
        <div className="draft-fields">
          <input
            className="draft-course"
            value={draft.courseName}
            onChange={(event) => onChange({ ...draft, courseName: event.target.value })}
            placeholder="Course"
            aria-label="Course name"
            style={{ width: `${Math.max(8, Math.min(28, draft.courseName.length * 0.62 + 6))}ch` }}
          />
          <input
            type="datetime-local"
            value={localValue}
            onChange={(event) =>
              onChange({ ...draft, dueAt: event.target.value ? new Date(event.target.value).toISOString() : null })
            }
            aria-label="Due date"
          />
          <input
            className="draft-points"
            type="number"
            min={0}
            max={1000}
            value={draft.maxPoints ?? ""}
            onChange={(event) =>
              onChange({ ...draft, maxPoints: event.target.value ? Number(event.target.value) : null })
            }
            placeholder="pts"
            aria-label="Points"
          />
          <label className="check-filter">
            <input
              type="checkbox"
              checked={draft.submitted}
              onChange={(event) => onChange({ ...draft, submitted: event.target.checked })}
            />
            <span>Done</span>
          </label>
          <label className="check-filter">
            <input
              type="checkbox"
              checked={draft.missing}
              onChange={(event) => onChange({ ...draft, missing: event.target.checked })}
            />
            <span>Missing</span>
          </label>
        </div>
      </div>
      <button
        type="button"
        className="icon-btn draft-remove"
        onClick={onRemove}
        aria-label={`Remove ${draft.title}`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function SettingsHead({
  icon,
  title,
  subtitle,
  status,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  status: ReactNode;
}) {
  return (
    <div className="settings-head">
      <span className="icon-tile">{icon}</span>
      <div className="settings-head-copy">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {status}
    </div>
  );
}

function SetupStep({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li>
      <span className="step-number">{n}</span>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Command({ name, text }: { name: string; text: string }) {
  return (
    <div className="command-row">
      <code>{name}</code>
      <span>{text}</span>
    </div>
  );
}

function CodeBlock({ lines }: { lines: string[] }) {
  const value = lines.join("\n");
  return (
    <div className="code-block">
      <pre>
        {lines.map((line) => (
          <code key={line}>{line}</code>
        ))}
      </pre>
      <CopyButton value={value} label="Copy" />
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={copy}
      aria-label={copied ? "Copied" : label ? "Copy to clipboard" : `Copy ${value}`}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </button>
  );
}
