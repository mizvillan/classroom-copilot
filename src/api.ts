import type { Briefing, Dashboard, ImportDraft, StudyKit, SyncResult } from "./types";

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "request_failed", status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError(
      "Can't reach the Classroom Copilot server. Is it running?",
      "network_error",
    );
  }

  if (!response.ok) {
    let body: { message?: string; error?: string } = {};
    try {
      body = await response.json();
    } catch {
      // Non-JSON error body from a proxy or crash.
    }
    throw new ApiError(
      body.message || `Request failed (${response.status}).`,
      body.error || "request_failed",
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export function fetchDashboard(): Promise<Dashboard> {
  return request<Dashboard>("/api/dashboard", { cache: "no-store" });
}

export function syncNow(): Promise<SyncResult> {
  return request<SyncResult>("/api/sync", { method: "POST", body: "{}" });
}

export function requestBriefing(options: {
  demo: boolean;
  force?: boolean;
}): Promise<Briefing> {
  return request<Briefing>("/api/briefing", {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export function disconnectGoogle(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
    body: "{}",
  });
}

export function sendDiscordTest(): Promise<{ ok: boolean; channel: string }> {
  return request<{ ok: boolean; channel: string }>("/api/discord/test", {
    method: "POST",
    body: "{}",
  });
}

export function parseImport(text: string): Promise<{ drafts: ImportDraft[]; count: number }> {
  return request("/api/import/parse", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function applyImport(drafts: ImportDraft[]): Promise<{ ok: boolean; imported: number }> {
  return request("/api/import/apply", {
    method: "POST",
    body: JSON.stringify({ drafts }),
  });
}

export function studyKit(assignmentId: string, force = false): Promise<StudyKit> {
  return request("/api/study", {
    method: "POST",
    body: JSON.stringify({ assignmentId, force }),
  });
}
