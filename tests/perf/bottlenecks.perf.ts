// Bottlenecks, timed. Builds a database the size of a real one (JOBHUNT_PERF_JOBS jobs, 100,000 by default, with
// posting text) and times what people wait for: the feed, search, opening a job, the Sources page, scoring every job
// after a profile change, and saving a board on a refresh. It also measures the longest the app stops answering
// while each runs, since everything runs on one thread. Each has a budget; the report lists them all.
//   npm run test:perf            (about a minute; needs a few hundred MB of temporary disk)
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, before, test } from "node:test";
import { isolate } from "../helpers";

const dir = isolate("perf");
const JOBS = Number(process.env.JOBHUNT_PERF_JOBS ?? 100_000);
const PER_BOARD = 200;

let store: typeof import("../../src/lib/store");
let ingest: typeof import("../../src/lib/ingest");
const report: Array<{ what: string; ms: number; budget: number; stall: number }> = [];

const TITLES = ["Data Engineer", "Software Engineer", "Senior Data Analyst", "Product Manager", "Registered Nurse", "Account Executive", "Machine Learning Engineer", "Financial Analyst", "UX Designer", "Recruiter"];
const PLACES = ["Austin, TX", "New York, NY", "London", "Remote", "Seattle, WA", "Berlin", "San Francisco, CA", "Manchester"];
const SKILLS = [["python", "sql"], ["javascript", "react"], ["sql", "tableau"], ["aws", "docker"], [], ["python", "machine_learning"]];
const TEXT = "<p>We build things. You will work with the team on interesting problems, write and review code, and talk to customers. "
  + "Requirements: 2+ years of experience, Python and SQL. We are unable to sponsor visas for this role. Benefits: health, dental, vision, 401(k).</p>".repeat(8);

/** Runs `work` and returns how long it took and the longest gap in which a timer could not run (the app was stuck). */
async function timed(work: () => unknown): Promise<{ ms: number; stall: number }> {
  let last = performance.now();
  let stall = 0;
  const tick = setInterval(() => { const now = performance.now(); stall = Math.max(stall, now - last - 10); last = now; }, 10);
  const start = performance.now();
  await work();
  const ms = performance.now() - start;
  await new Promise((r) => setTimeout(r, 15));
  clearInterval(tick);
  // A synchronous piece of work longer than the whole run is a stall of that length.
  stall = Math.max(stall, performance.now() - last - 10);
  return { ms: Math.round(ms), stall: Math.round(Math.max(0, stall)) };
}

async function measure(what: string, budget: number, work: () => unknown, stallBudget = budget): Promise<void> {
  const r = await timed(work);
  report.push({ what, ms: r.ms, budget, stall: r.stall });
  assert.ok(r.ms <= budget, `${what}: ${r.ms} ms, budget ${budget} ms`);
  assert.ok(r.stall <= stallBudget, `${what}: the app stopped answering for ${r.stall} ms, budget ${stallBudget} ms`);
}

function row(board: number, slug: string, i: number): import("../../src/lib/store").JobRow {
  const title = TITLES[i % TITLES.length];
  const location = PLACES[(i * 7) % PLACES.length];
  return {
    id: `greenhouse:${slug}:${i}`, boardId: board, ats: "greenhouse", url: `https://boards.greenhouse.io/${slug}/jobs/${i}`, applyUrl: "", title: `${title} ${i % 97}`,
    company: `Company ${slug}`, location, country: /London|Manchester/.test(location) ? "UK" : /Berlin/.test(location) ? "other" : location === "Remote" ? "unknown" : "US",
    workModel: location === "Remote" ? "remote" : null, employmentType: "Full-time", department: "Engineering", family: null, level: i % 3 ? "mid" : "entry", yearsMin: i % 5,
    payMin: i % 4 ? null : 90000, payMax: i % 4 ? null : 140000, payCurrency: i % 4 ? null : "USD", payPeriod: i % 4 ? null : "year",
    postedAt: new Date(Date.now() - (i % 60) * 86_400_000).toISOString(), descriptionHtml: TEXT, skills: SKILLS[i % SKILLS.length], sponsorship: i % 9 ? null : "no",
    eVerify: null, blocker: i % 9 ? null : "no_sponsorship", blockerText: null, evidence: {}, h1bFilings: i % 2 ? 120 : 0, capExempt: false, ukSponsor: i % 3 === 0,
  };
}

before(async () => {
  store = await import("../../src/lib/store");
  ingest = await import("../../src/lib/ingest");
  for (const c of store.listCollections()) store.setCollectionEnabled(c.id, false);
  store.db().prepare("UPDATE boards SET enabled = 0").run();
  const t = performance.now();
  for (let b = 0; b < Math.ceil(JOBS / PER_BOARD); b++) {
    const slug = `perf${b}`;
    const id = store.addBoard("greenhouse", slug, `Company ${slug}`);
    store.saveBoardListing(id, Array.from({ length: PER_BOARD }, (_, i) => row(id, slug, i)));
  }
  console.log(`Built ${JOBS.toLocaleString()} jobs in ${Math.round((performance.now() - t) / 1000)} s.`);
  store.saveProfile({ ...store.getProfile(), targetTitles: ["Data Engineer"], skills: ["python", "sql"], years: 2, needsSponsorship: true, region: "us" });
});

test("scoring every job after a profile change", async () => {
  // Hundreds of thousands of jobs take seconds; what matters is that the app keeps answering in between.
  await measure("score every job", Math.max(10_000, JOBS / 10), () => ingest.rescore(true), 250);
});

test("the feed, search and filters", async () => {
  await measure("feed, first load", 1500, () => store.feed({ limit: 40 }));
  await measure("feed, again", 500, () => store.feed({ limit: 40 }));
  await measure("feed, next page", 500, () => store.feed({ limit: 40, offset: 40 }));
  await measure("newest first", 500, () => store.feed({ limit: 40, sort: "newest" }));
  await measure("best matches first", 500, () => store.feed({ limit: 40, sort: "score", minScore: 60 }));
  await measure("search: data engineer", 300, () => store.feed({ limit: 40, q: "data engineer" }));
  await measure("search: eng (a short prefix)", 600, () => store.feed({ limit: 40, q: "eng" }));
  await measure("UK jobs, sponsors only", 600, () => store.feed({ limit: 40, region: "uk", h1bOnly: true }));
  await measure("remote entry level, pay listed", 600, () => store.feed({ limit: 40, workModels: ["remote"], levels: ["entry"], payListed: true }));
});

test("opening a job and the Sources page", async () => {
  await measure("open a job", 30, () => store.jobDetail("greenhouse:perf3:17"));
  await measure("collections (first)", 1000, () => store.listCollections());
  await measure("collections (again)", 100, () => store.listCollections());
  await measure("boards list (again)", 150, () => store.listBoards());
});

test("saving a board on a refresh", async () => {
  const id = store.addBoard("greenhouse", "bigboard", "Big Board");
  const rows = Array.from({ length: 2000 }, (_, i) => row(id, "bigboard", i));
  await measure("save 2,000 new jobs", 3000, () => store.saveBoardListing(id, rows), 3000);
  let written = -1;
  await measure("save the same 2,000 again (unchanged)", 1500, () => { written = store.saveBoardListing(id, rows).written.size; }, 1500);
  assert.equal(written, 0, "unchanged jobs are not written again");
});

after(() => {
  console.log(`\nBottleneck report (${JOBS.toLocaleString()} jobs)\n`);
  console.log(`${"".padEnd(40)}${"time".padStart(9)}${"budget".padStart(9)}${"longest stop".padStart(15)}`);
  for (const r of report) console.log(`${r.what.padEnd(40)}${`${r.ms} ms`.padStart(9)}${`${r.budget}`.padStart(9)}${`${r.stall} ms`.padStart(15)}${r.ms > r.budget ? "  OVER BUDGET" : ""}`);
  store?.db().close();
  rmSync(dir, { recursive: true, force: true });
});
