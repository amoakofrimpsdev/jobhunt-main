// Bottlenecks that can be seen without timing anything: every statement the feed, its counts, scoring and the
// Sources page run is recorded, and SQLite is asked how it would run each one. A job row holds the whole posting,
// so a statement that walks the jobs table itself (rather than one of its small indexes) reads the whole database
// and takes seconds once there are hundreds of thousands of jobs. None may.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { isolate } from "./helpers";

isolate("plans");

let store: typeof import("../src/lib/store");
const statements = new Set<string>();
let explain: (sql: string) => Array<{ detail: string }>;

before(async () => {
  store = await import("../src/lib/store");
  const d = store.db();
  const prepare = d.prepare.bind(d);
  explain = (sql) => prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>;
  d.prepare = ((sql: string) => { statements.add(sql); return prepare(sql); }) as typeof d.prepare;
  store.saveProfile({ ...store.getProfile(), targetTitles: ["Data Engineer"], skills: ["python"], years: 1, needsSponsorship: true, region: "us" });
});

/**
 * The plan lines of a statement that read job rows themselves: a scan of the table, or a search through an index that
 * does not hold every column asked for. Looking up single jobs by their id (a page of cards) is the one fine case.
 */
function tableWalks(sql: string): string[] {
  return explain(sql).map((r) => r.detail)
    .filter((p) => /^(?:SCAN|SEARCH) (?:j|jobs)\b/.test(p) && !/COVERING INDEX/.test(p) && !/\((?:id|rowid)=\?\)|USING INTEGER PRIMARY KEY/.test(p));
}

function check(what: string, run: () => unknown): void {
  statements.clear();
  run();
  assert.ok(statements.size > 0, `${what} ran no statement`);
  for (const sql of [...statements]) {
    if (/^\s*(?:INSERT|UPDATE|DELETE|PRAGMA|CREATE|DROP|BEGIN|COMMIT|ROLLBACK)/i.test(sql)) continue;
    const walks = tableWalks(sql);
    assert.deepEqual(walks, [], `${what} reads the whole jobs table:\n${sql.replace(/\s+/g, " ").slice(0, 300)}`);
  }
}

test("the feed reads only indexes, whatever the filters", () => {
  const base = { limit: 40 };
  check("the recommended feed", () => store.feed({ ...base, sort: "recommended" }));
  check("the newest first", () => store.feed({ ...base, sort: "newest" }));
  check("the best matches first", () => store.feed({ ...base, sort: "score", minScore: 60 }));
  check("a search", () => store.feed({ ...base, q: "data engineer" }));
  check("the UK feed with sponsors only", () => store.feed({ ...base, region: "uk", h1bOnly: true, hideBlocked: true }));
  check("remote entry-level jobs from the last week", () => store.feed({ ...base, workModels: ["remote"], levels: ["entry"], postedWithinDays: 7, payListed: true }));
  check("jobs on chosen job boards", () => store.feed({ ...base, boards: ["greenhouse", "lever"] }));
  check("a later page", () => store.feed({ ...base, offset: 200 }));
});

test("scoring, counting and the Sources page read only indexes", () => {
  const boards = store.activeBoardIds().slice(0, 50);
  check("reading jobs to score", () => store.jobsForScoring(false, boards));
  check("reading unscored jobs", () => store.jobsForScoring(true, boards));
  check("open jobs per board", () => store.openJobsByBoard());
  check("the collections", () => store.listCollections());
  check("the boards", () => store.listBoards());
  check("whether anything needs scoring", () => store.needsScoring());
});
