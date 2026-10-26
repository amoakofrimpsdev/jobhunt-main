// The match score and the taxonomies under it. Scores must be stable (the same inputs, the same number) and must
// follow the rules the app tells people it uses.
import assert from "node:assert/strict";
import { test } from "node:test";
import { capExemptLikely, companyKey, h1bFilings } from "../src/lib/company";
import { bandFor, scoreJob, scorerFor } from "../src/lib/match";
import { proposeProfile } from "../src/lib/resume";
import { familyOfTitle, scanSkills, skillIdFor } from "../src/lib/taxonomy";
import { EMPTY_PROFILE, type Profile } from "../src/lib/types";

const profile: Profile = { ...EMPTY_PROFILE, targetTitles: ["Data Analyst"], skills: ["sql", "python", "tableau"], years: 3 };
const job = { title: "Data Analyst", family: "data", level: "mid", yearsMin: 2, skills: ["sql", "python", "tableau", "excel"], blocker: null };

test("skills are found as whole words", () => {
  const found = scanSkills("We use Python, SQL and JavaScript. Experience with Tableau is a plus.");
  for (const s of ["python", "sql", "javascript", "tableau"]) assert.ok(found.includes(s), s);
  // JavaScript is never Java.
  assert.ok(!found.includes("java"));
  assert.equal(skillIdFor("Power BI"), "power_bi");
});

test("titles map to kinds of work", () => {
  assert.equal(familyOfTitle("Senior Data Analyst")?.family, "data");
  assert.equal(familyOfTitle("Software Engineer II, Payments")?.family, "software");
  assert.equal(familyOfTitle("Zzyzx Wrangler"), null);
});

test("a matching job scores high, and the same inputs give the same score", () => {
  const a = scoreJob(scorerFor(profile), job);
  const b = scoreJob(scorerFor(profile), job);
  assert.ok(a && a.score >= 80, String(a?.score));
  assert.deepEqual(a, b);
  assert.equal(a.band, "strong");
  assert.equal(a.parts.length, 3);
  assert.ok(a.parts.every((p) => p.reasons.length > 0));
});

test("a different kind of work is held down even when tools overlap", () => {
  const m = scoreJob(scorerFor(profile), { ...job, title: "Account Executive", family: "sales" });
  assert.ok(m && m.score <= 55, String(m?.score));
});

test("a visa blocker caps the score only for someone who needs sponsorship", () => {
  const blocked = { ...job, blocker: "no_sponsorship" };
  assert.ok(scoreJob(scorerFor(profile), blocked)!.score >= 80);
  const capped = scoreJob(scorerFor({ ...profile, needsSponsorship: true }), blocked)!;
  assert.equal(capped.score, 20);
  assert.ok(capped.cap);
});

test("an empty profile gives no score at all", () => {
  assert.equal(scoreJob(scorerFor(EMPTY_PROFILE), job), null);
});

test("bands", () => {
  assert.deepEqual([85, 70, 55, 30].map(bandFor), ["strong", "good", "fair", "low"]);
});

test("companies named like built-in words get no made-up filings", async () => {
  const { h1bFilings, ukSponsorLikely } = await import("../src/lib/company");
  for (const name of ["Constructor", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf"]) {
    assert.equal(h1bFilings(name), 0, name);
    assert.equal(typeof ukSponsorLikely(name), "boolean", name);
  }
});

test("company names are matched whatever their legal form", () => {
  assert.equal(companyKey("Stripe, Inc."), "stripe");
  assert.equal(companyKey("STRIPE INC"), "stripe");
  assert.equal(companyKey("The Home Depot"), "homedepot");
  assert.ok(h1bFilings("Google LLC") > 100);
  assert.equal(h1bFilings("Definitely Not A Real Employer 12345"), 0);
});

test("cap-exempt employers are read from the name", () => {
  assert.ok(capExemptLikely("University of Washington"));
  assert.ok(capExemptLikely("Fred Hutchinson Cancer Research Center"));
  assert.ok(!capExemptLikely("University of Phoenix"));
  assert.ok(!capExemptLikely("Stripe"));
});

test("a resume is read into titles, skills and years", () => {
  const p = proposeProfile(`Jordan Testwell
Seattle, WA

EXPERIENCE
Data Analyst, Northwind Traders     Jan 2022 - Dec 2023
- Built dashboards in Tableau with SQL and Python.

EDUCATION
University of Washington            2016 - 2020

SKILLS
SQL, Python, Tableau, Product management`);
  assert.equal(p.name, "Jordan Testwell");
  assert.deepEqual(p.targetTitles, ["Data Analyst"]);
  for (const s of ["sql", "python", "tableau"]) assert.ok(p.skills.includes(s), s);
  // Two years of work; the four years of school are not experience.
  assert.equal(p.years, 2);
});
