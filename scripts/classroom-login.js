/**
 * One-time visible Google login for the Classroom browser sync.
 *
 * Opens the SAME persistent browser profile the background sync uses, but
 * visible on screen, so you can sign in (or pass any security checks). After
 * that window, the headless sync keeps the session alive on its own — Google
 * rotates the cookies transparently inside the profile.
 */

import { launchPersistentForLogin } from "../server/harvest.js";

const context = await launchPersistentForLogin(false); // headful

console.log("\n  A browser window opened with the sync profile.");
console.log("  → Sign in with your SCHOOL Google account (the one your Classroom uses).");
console.log("  → Once the Classroom home page loads, just close the window.\n");

await new Promise((resolve) => {
  context.on("close", resolve);
  process.on("SIGINT", () => {
    resolve();
  });
});

// On close, the profile has saved whatever session it holds.
process.exit(0);
