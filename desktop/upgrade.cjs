// The database's slow upgrade steps, run once before the app starts (desktop/launch.cjs on the Mac,
// desktop/windows/launcher.cjs on Windows). Building an index over half a million jobs reads the whole database, which
// can take minutes; done inside the app, it kept the window blank until it finished, and a person who quit in the
// meantime started it all over again on the next launch. Here it runs on a worker thread while a small page says
// what is happening.
//
// The statements are the same as in src/lib/store.ts (tests/upgrade.test.ts checks that), and all of them are safe
// to run again: the app runs its own copies on start and finds them done.
const { existsSync } = require("node:fs");

const FEED_INDEX = `
DROP INDEX IF EXISTS jobs_light;
DROP INDEX IF EXISTS jobs_feed;
CREATE INDEX IF NOT EXISTS jobs_feed2 ON jobs (closed_at, board_id, id, company, title, location, department, country,
  posted_at, first_seen_at, seen_new, blocker, work_model, level, years_min, family, h1b_filings, e_verify, cap_exempt, uk_sponsor, pay_min, skills);
`;

const MATCHES = `
DROP INDEX IF EXISTS matches_by_job;
DROP INDEX IF EXISTS matches_by_score;
DROP TABLE IF EXISTS matches;
CREATE TABLE IF NOT EXISTS matches (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  score INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS matches_by_score ON matches (score, job_id);
`;

const SEARCH_INDEX = `
CREATE VIRTUAL TABLE IF NOT EXISTS jobs_search USING fts5(title, company, location, department, content='jobs', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2', prefix='2 3');
CREATE TRIGGER IF NOT EXISTS jobs_search_insert AFTER INSERT ON jobs BEGIN
  INSERT INTO jobs_search (rowid, title, company, location, department) VALUES (new.rowid, new.title, new.company, new.location, new.department);
END;
CREATE TRIGGER IF NOT EXISTS jobs_search_delete AFTER DELETE ON jobs BEGIN
  INSERT INTO jobs_search (jobs_search, rowid, title, company, location, department) VALUES ('delete', old.rowid, old.title, old.company, old.location, old.department);
END;
CREATE TRIGGER IF NOT EXISTS jobs_search_update AFTER UPDATE OF title, company, location, department ON jobs BEGIN
  INSERT INTO jobs_search (jobs_search, rowid, title, company, location, department) VALUES ('delete', old.rowid, old.title, old.company, old.location, old.department);
  INSERT INTO jobs_search (rowid, title, company, location, department) VALUES (new.rowid, new.title, new.company, new.location, new.department);
END;
`;

function open(file) {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const d = new DatabaseSync(file);
  d.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 30000; PRAGMA cache_size = -131072; PRAGMA temp_store = FILE;");
  return d;
}

/** The slow steps this database still needs, as { id, label }. Empty for a new or up-to-date database. Quick. */
function pendingSteps(file) {
  if (!existsSync(file)) return [];
  const d = open(file);
  try {
    const has = (name) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name);
    if (!has("jobs")) return [];
    const jobColumns = d.prepare("PRAGMA table_info(jobs)").all().map((c) => c.name);
    const steps = [];
    // Older databases still need columns only the app adds; it builds this index itself after adding them.
    if (jobColumns.includes("uk_sponsor") && !has("jobs_feed2")) steps.push({ id: "feed", label: "Building the job list index" });
    if (has("matches")) {
      const cols = d.prepare("PRAGMA table_info(matches)").all().map((c) => c.name);
      const sql = d.prepare("SELECT sql FROM sqlite_master WHERE name = 'matches'").get()?.sql ?? "";
      if (cols.includes("detail") || !/WITHOUT ROWID/i.test(sql)) steps.push({ id: "matches", label: "Clearing the old match scores (they are worked out again)" });
    }
    if (!has("jobs_search")) steps.push({ id: "search", label: "Building the search index" });
    return steps;
  } finally {
    d.close();
  }
}

/** Runs the pending steps, telling `report` as each starts. */
function runSteps(file, report) {
  const steps = pendingSteps(file);
  const d = open(file);
  try {
    for (const step of steps) {
      report(step);
      if (step.id === "feed") d.exec(FEED_INDEX);
      else if (step.id === "matches") d.exec(MATCHES);
      else if (step.id === "search") { d.exec(SEARCH_INDEX); d.exec("INSERT INTO jobs_search (jobs_search) VALUES ('rebuild')"); }
    }
    if (steps.length) {
      report({ id: "tidy", label: "Tidying up" });
      d.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;");
    }
  } finally {
    d.close();
  }
}

// On a worker thread: run the steps for the file it was given and report to the thread that started it.
const { isMainThread, parentPort, workerData } = require("node:worker_threads");
if (!isMainThread && workerData && workerData.jobhuntUpgrade) {
  try {
    runSteps(workerData.file, (step) => parentPort.postMessage({ step }));
    parentPort.postMessage({ done: true });
  } catch (e) {
    parentPort.postMessage({ error: e && e.message ? e.message : String(e) });
  }
}

const PAGE = (label, seconds) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Jobhunt</title>
<style>body{margin:0;font:16px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;background:#fffaf0;color:#0a0a0a;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}main{max-width:460px}h1{font-size:30px;margin:0 0 8px;font-weight:600}p{color:#55534e;margin:6px 0}.bar{height:4px;background:#ebe6d6;border-radius:2px;overflow:hidden;margin:20px 0}.bar i{display:block;height:100%;width:40%;background:#ff4d8b;animation:a 1.4s ease-in-out infinite}@keyframes a{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}</style></head>
<body><main><h1>Updating your job database</h1><p>A one-time step after this update. With hundreds of thousands of jobs it can take a few minutes; please leave Jobhunt open.</p>
<div class="bar"><i></i></div><p id="s"><b>${label}</b> · ${seconds}s</p></main>
<script>setInterval(async()=>{try{const r=await fetch("/__upgrade");const j=await r.json();if(j.done)location.reload();else document.getElementById("s").innerHTML="<b>"+j.label+"</b> · "+j.seconds+"s"}catch{setTimeout(()=>location.reload(),1500)}},1000)</script></body></html>`;

/**
 * When the database in `dataDir` needs slow steps: serves a page on `port` that says so, runs the steps on a worker
 * thread, then closes the page and resolves. Resolves at once when there is nothing to do.
 */
async function upgradeBeforeStart({ dataDir, port, host = "127.0.0.1", workerFile = __filename }) {
  const file = require("node:path").join(dataDir, "jobhunt.db");
  let steps;
  try { steps = pendingSteps(file); } catch { return; }
  if (!steps.length) return;
  const http = require("node:http");
  const { Worker } = require("node:worker_threads");
  const started = Date.now();
  let label = steps[0].label;
  const server = http.createServer((req, res) => {
    const seconds = Math.round((Date.now() - started) / 1000);
    if (req.url === "/__upgrade") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ label, seconds })); }
    // The browser extension asks whether Jobhunt is here: not yet.
    if (req.url && req.url.startsWith("/api/")) { res.writeHead(503, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "Jobhunt is updating its database. Try again in a few minutes." })); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(PAGE(label, seconds));
  });
  // If the port is taken the page is simply not shown; the update still runs.
  await new Promise((resolve) => { server.once("error", resolve); server.listen(port, host, resolve); });
  console.log(`Updating the database: ${steps.map((s) => s.label).join(", ")}…`);
  await new Promise((resolve) => {
    const worker = new Worker(workerFile, { workerData: { jobhuntUpgrade: true, file } });
    worker.on("message", (m) => {
      if (m.step) { label = m.step.label; console.log(`  ${label} (${Math.round((Date.now() - started) / 1000)}s)`); }
      if (m.error) console.error(`The update stopped: ${m.error}. The app will try again.`);
    });
    worker.on("exit", resolve);
    worker.on("error", (e) => { console.error(`The update stopped: ${e.message}`); resolve(); });
  });
  console.log(`Database updated in ${Math.round((Date.now() - started) / 1000)}s.`);
  // The page polls /__upgrade; once the port is the app's, its reload shows the app.
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
}

module.exports = { pendingSteps, runSteps, upgradeBeforeStart, SQL: { FEED_INDEX, MATCHES, SEARCH_INDEX } };
