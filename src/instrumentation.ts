/** Runs once when the server starts: leaves a note of where it is listening for the Claude Desktop connector, and
 *  opens the phone door again if phone access was left on. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { writeRunFile } = await import("./lib/runfile");
  writeRunFile();
  try {
    // Scores dropped by an upgrade are made again in the background; the feed fills in its order as they arrive.
    const { needsScoring } = await import("./lib/store");
    if (needsScoring()) void import("./lib/ingest").then((m) => m.rescore()).catch(() => undefined);
  } catch (e) {
    console.error("Scoring at start failed:", e instanceof Error ? e.message : e);
  }
  try {
    const { restorePhone } = await import("./lib/phone");
    await restorePhone();
  } catch (e) {
    console.error("Phone access could not be restored:", e instanceof Error ? e.message : e);
  }
}
