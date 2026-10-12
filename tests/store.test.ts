// The database end to end, on a throwaway data folder: reading a board in, closing what disappears, dates, scoring,
// the feed's filters, the tracker, alerts, and what the browser extension is allowed.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import type { RawJob } from "../src/lib/types";

process.env.JOBHUNT_DATA_DIR = mkdtempSync(join(tmpdir(), "jobhunt-test-"));
process.env.JOBHUNT_QUIET = "1";

// Loaded after the data folder is set, so nothing here can touch a real database.
let store: typeof import("../src/lib/store");
let ingest: typeof import("../src/lib/ingest");
let alerts: typeof import("../src/lib/alerts");
let ext: typeof import("../src/lib/ext");
let answers: typeof import("../src/lib/answers");

const raw = (id: string, title: string, over: Partial<RawJob> = {}): RawJob => ({
  externalId: id, url: `https://boards.greenhouse.io/testco/jobs/${id}`, applyUrl: "", title, company: "Testco", location: "Seattle, WA",
  descriptionHtml: "<p>We need SQL, Python and Tableau. 2+ years of experience in analytics.</p>", workModel: null, employmentType: null,
  department: "Data", postedAt: "2026-01-05T00:00:00.000Z", countryCode: null, pay: null, ...over,
});

let board: { id: number; ats: "greenhouse"; slug: string };
const save = (jobs: RawJob[], closeMissing = true) => store.saveBoardListing(board.id, jobs.map((j) => ingest.toJobRow(board, j)), closeMissing);
const all = { usOnly: false, hideBlocked: false, limit: 100 };
const ids = (f: Parameters<typeof store.feed>[0] = {}) => store.feed({ ...all, ...f }).jobs.map((j) => j.id).sort();

before(async () => {
  store = await import("../src/lib/store");
  ingest = await import("../src/lib/ingest");
  alerts = await import("../src/lib/alerts");
  ext = await import("../src/lib/ext");
  answers = await import("../src/lib/answers");
  board = { id: store.addBoard("greenhouse", "testco", "Testco"), ats: "greenhouse", slug: "testco" };
  // Only this board counts in these tests: the collections that ship with the app are switched off.
  for (const c of store.listCollections()) store.setCollectionEnabled(c.id, false);
  store.db().prepare("UPDATE boards SET enabled = 0 WHERE id != ?").run(board.id);
});

test("a fresh database follows the collections that ship with the app", () => {
  assert.ok(store.listCollections().length >= 6);
  assert.ok(store.listBoards().length > 1000);
});

test("reading a board saves its jobs with their facts", () => {
  const r = save([raw("1", "Data Analyst"), raw("2", "Senior Software Engineer", { location: "London, UK" }), raw("3", "Data Analyst", { descriptionHtml: "<p>We are unable to sponsor visas.</p>" })]);
  assert.deepEqual({ added: r.added, closed: r.closed, written: r.written.size }, { added: 3, closed: 0, written: 3 });
  assert.deepEqual(ids(), ["greenhouse:testco:1", "greenhouse:testco:2", "greenhouse:testco:3"]);
  const job = store.jobDetail("greenhouse:testco:1")!;
  assert.equal(job.yearsMin, 2);
  assert.deepEqual(job.skills.map((s) => s.id).sort(), ["python", "sql", "tableau"]);
  assert.equal(store.jobDetail("greenhouse:testco:3")!.blocker, "no_sponsorship");
});

test("filters: country, visa blockers, search, job board", () => {
  assert.deepEqual(ids({ usOnly: true }), ["greenhouse:testco:1", "greenhouse:testco:3"]);
  assert.deepEqual(ids({ hideBlocked: true }), ["greenhouse:testco:1", "greenhouse:testco:2"]);
  assert.deepEqual(ids({ q: "software" }), ["greenhouse:testco:2"]);
  assert.equal(ids({ boards: ["greenhouse"] }).length, 3);
  assert.equal(ids({ boards: ["workday"] }).length, 0);
});

test("a job missing from a complete read is closed; a partial read closes nothing", () => {
  assert.equal(save([raw("1", "Data Analyst"), raw("2", "Senior Software Engineer", { location: "London, UK" })], false).closed, 0);
  assert.equal(ids().length, 3);
  assert.equal(save([raw("1", "Data Analyst"), raw("2", "Senior Software Engineer", { location: "London, UK" })]).closed, 1);
  assert.deepEqual(ids(), ["greenhouse:testco:1", "greenhouse:testco:2"]);
  // It reopens when the board lists it again.
  save([raw("1", "Data Analyst"), raw("2", "Senior Software Engineer", { location: "London, UK" }), raw("3", "Data Analyst")]);
  assert.equal(ids().length, 3);
});

test("the day a board was first read is not a posting date", () => {
  save([raw("1", "Data Analyst"), raw("2", "Senior Software Engineer", { location: "London, UK" }), raw("3", "Data Analyst"), raw("4", "Analytics Engineer", { postedAt: null })]);
  const late = store.jobDetail("greenhouse:testco:4")!;
  // Job 4 arrived on a board already being followed: the day it was found stands in for its date.
  assert.equal(late.postedAt, null);
  assert.equal(late.seenNew, true);
  // Jobs 1 to 3 were there on the first read.
  assert.equal(store.jobDetail("greenhouse:testco:1")!.seenNew, false);
});

test("scoring follows the profile, and the feed can be ordered by it", async () => {
  assert.equal(store.feed(all).jobs[0].match, null);
  store.saveProfile({ ...store.getProfile(), targetTitles: ["Data Analyst"], skills: ["sql", "python", "tableau"], years: 3 });
  assert.equal(await ingest.rescore(true), 4);
  const top = store.feed({ ...all, sort: "score" }).jobs;
  assert.equal(top[0].title, "Data Analyst");
  assert.ok(top[0].match!.score > top[top.length - 1].match!.score);
  const strong = ids({ minScore: 80 });
  assert.ok(strong.includes("greenhouse:testco:1") && !strong.includes("greenhouse:testco:2"));
  // A posting that reads the same on the next read is left alone and keeps its score; one that changed is written
  // and scored again.
  const again = [raw("1", "Data Analyst"), raw("2", "Senior Software Engineer", { location: "London, UK" }), raw("3", "Data Analyst"), raw("4", "Analytics Engineer", { postedAt: null })];
  const changed = save(again.map((j) => (j.externalId === "1" ? { ...j, title: "Senior Data Analyst" } : j)));
  assert.ok(changed.written.has("greenhouse:testco:1"));
  assert.ok(changed.written.size < 4);
  assert.equal(await ingest.rescore(), changed.written.size);
  assert.equal(store.jobDetail("greenhouse:testco:1")!.title, "Senior Data Analyst");
  save(again);
  await ingest.rescore();
});

test("a job that is applied to leaves the feed and stays in the tracker", () => {
  assert.equal(store.track("greenhouse:testco:1", "applied", "Referred by Sam"), true);
  assert.ok(!ids().includes("greenhouse:testco:1"));
  const t = store.tracked();
  assert.equal(t.length, 1);
  assert.equal(t[0].notes, "Referred by Sam");
  assert.equal(store.track("no-such-job", "saved"), false);
  // Saved jobs stay in the feed.
  store.track("greenhouse:testco:2", "saved");
  assert.ok(ids().includes("greenhouse:testco:2"));
});

test("an alert reports only jobs that are new since it was made", async () => {
  alerts.createAlert("Analysts", "q=analyst&us=0&hideBlocked=0");
  assert.equal(alerts.runAlerts(), 0);
  await new Promise((r) => setTimeout(r, 15));
  save([raw("1", "Data Analyst"), raw("2", "Senior Software Engineer", { location: "London, UK" }), raw("3", "Data Analyst"), raw("4", "Analytics Engineer", { postedAt: null }), raw("5", "Product Analyst"), raw("6", "Recruiter")]);
  assert.equal(alerts.runAlerts(), 1);
  assert.equal(alerts.unseenHits(), 1);
  assert.equal(alerts.listHits()[0].title, "Product Analyst");
  // The same job is not reported twice.
  assert.equal(alerts.runAlerts(), 0);
  alerts.markHitsSeen();
  assert.equal(alerts.unseenHits(), 0);
});

test("the extension gets nothing without the pairing code", () => {
  const code = ext.extToken();
  assert.ok(code.length >= 24);
  assert.equal(ext.extTokenOk(code), true);
  assert.equal(ext.extTokenOk("wrong"), false);
  assert.equal(ext.extTokenOk(null), false);
  // A new code cuts off the old one.
  const next = ext.newExtToken();
  assert.equal(ext.extTokenOk(code), false);
  assert.equal(ext.extTokenOk(next), true);
});

test("a page in the browser is matched to its job", () => {
  assert.equal(ext.jobIdForUrl("https://boards.greenhouse.io/testco/jobs/2?gh_src=abc"), "greenhouse:testco:2");
  assert.equal(ext.jobIdForUrl("https://careers.testco.com/open-roles?gh_jid=5"), "greenhouse:testco:5");
  assert.equal(ext.jobIdForUrl("https://boards.greenhouse.io/testco/jobs/999"), null);
});

test("recorded answers are kept, replaced and forgotten", () => {
  answers.saveAnswer({ key: "phone", label: "Phone", value: "206 555 0134" });
  answers.saveAnswer({ key: "phone", label: "Phone", value: "(206) 555-0134" });
  assert.deepEqual(answers.listAnswers().filter((a) => a.key === "phone").map((a) => a.value), ["(206) 555-0134"]);
  answers.saveAnswer({ key: "phone", label: "Phone", value: "" });
  assert.equal(answers.listAnswers().some((a) => a.key === "phone"), false);
});
