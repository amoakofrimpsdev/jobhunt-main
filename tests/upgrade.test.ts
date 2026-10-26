// The slow, one-time database upgrade the desktop launchers run before the app starts (desktop/upgrade.cjs): it
// must match the app's own schema, and bring an old database up to it.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "jobhunt-upgrade-"));
process.env.JOBHUNT_DATA_DIR = dir;
const upgrade = createRequire(import.meta.url)("../desktop/upgrade.cjs") as {
  pendingSteps: (file: string) => Array<{ id: string }>;
  runSteps: (file: string, report: (s: { id: string }) => void) => void;
  SQL: { FEED_INDEX: string; SEARCH_INDEX: string; MATCHES: string };
};
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

test("the launcher's upgrade statements are the app's own", async () => {
  const store = await import("../src/lib/store");
  assert.equal(flat(upgrade.SQL.FEED_INDEX), flat(store.SCHEMA_SQL.FEED_INDEX));
  assert.equal(flat(upgrade.SQL.SEARCH_INDEX), flat(store.SCHEMA_SQL.SEARCH_INDEX));
});

test("an old database is brought up to date, and a current one needs nothing", async () => {
  const store = await import("../src/lib/store");
  const file = join(dir, "jobhunt.db");
  const d = store.db();
  const board = store.addBoard("greenhouse", "upgradeco", "Upgradeco");
  d.prepare(`INSERT INTO jobs (id, board_id, ats, url, apply_url, title, company, location, country, department, first_seen_at, last_seen_at, description_html)
    VALUES ('greenhouse:upgradeco:1', ?, 'greenhouse', 'https://x', '', 'Data Engineer', 'Upgradeco', 'London', 'UK', '', '2026-10-01', '2026-10-01', '<p>x</p>')`).run(board);
  assert.deepEqual(upgrade.pendingSteps(file), []);
  // The state an interrupted earlier update left: no feed index, scores with their whole breakdown, no search index.
  d.exec(`DROP INDEX jobs_feed2; DROP TABLE jobs_search; DROP TRIGGER jobs_search_insert; DROP TRIGGER jobs_search_delete; DROP TRIGGER jobs_search_update;
    DROP TABLE matches; CREATE TABLE matches (job_id TEXT PRIMARY KEY, score INTEGER NOT NULL, detail TEXT NOT NULL);`);
  assert.deepEqual(upgrade.pendingSteps(file).map((s) => s.id), ["feed", "matches", "search"]);
  const seen: string[] = [];
  upgrade.runSteps(file, (s) => seen.push(s.id));
  assert.deepEqual(seen, ["feed", "matches", "search", "tidy"]);
  assert.deepEqual(upgrade.pendingSteps(file), []);
  // The job held before is found by search.
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM jobs_search WHERE jobs_search MATCH '\"engin\"*'").get() as { n: number }).n, 1);
});
