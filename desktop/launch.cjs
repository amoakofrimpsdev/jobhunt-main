// Started by the desktop shell with its stdin held open. When the shell goes away, for any reason, stdin closes and
// the server exits with it, so no server is ever left running behind a closed app.
process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));
process.stdin.resume();
// A database that needs slow, one-time upgrade steps gets them first, with a page on the app's port saying so
// (desktop/upgrade.cjs); then the app starts.
require("./upgrade.cjs")
  .upgradeBeforeStart({ dataDir: process.env.JOBHUNT_DATA_DIR, port: Number(process.env.PORT), host: process.env.HOSTNAME || "127.0.0.1" })
  .catch((e) => console.error("Database update failed:", e && e.message ? e.message : e))
  .finally(() => require("./server.js"));
