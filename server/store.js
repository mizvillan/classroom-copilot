import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";

/**
 * A tiny JSON document store. Everything lives in data/ (gitignored), writes
 * are serialized and atomic, and reads are cached in memory so the dashboard
 * does not touch disk on every poll.
 */
class JsonStore {
  constructor(filename, fallback) {
    this.file = path.join(config.dataDir, filename);
    this.fallback = fallback;
    this.value = undefined;
    this.queue = Promise.resolve();
  }

  async read() {
    if (this.value !== undefined) return this.value;
    try {
      const raw = await readFile(this.file, "utf8");
      this.value = { ...this.fallback, ...JSON.parse(raw) };
    } catch {
      this.value = structuredClone(this.fallback);
    }
    return this.value;
  }

  async write(next) {
    this.value = next;
    const run = async () => {
      await mkdir(config.dataDir, { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      await rename(tmp, this.file);
    };
    this.queue = this.queue.then(run, run);
    await this.queue;
    return next;
  }

  async update(mutator) {
    const current = await this.read();
    const next = (await mutator(structuredClone(current))) || current;
    return this.write(next);
  }

  async clear() {
    return this.write(structuredClone(this.fallback));
  }
}

/** OAuth credentials + the signed-in profile. Never sent to the browser raw. */
export const tokenStore = new JsonStore("google-auth.json", {
  tokens: null,
  profile: null,
});

/** Last Classroom snapshot plus briefing/study-kit/digest bookkeeping. */
export const cacheStore = new JsonStore("classroom.json", {
  courses: [],
  assignments: [],
  submissions: {},
  knownIds: [],
  fetchedAt: null,
  briefing: null,
  studyKits: {},
  lastDigestDate: null,
  syncError: null,
});
