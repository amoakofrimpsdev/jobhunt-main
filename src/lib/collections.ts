// Re-reading a collection's own site for employers it has added. A collection is a site that lists many employers'
// jobs: a venture firm's portfolio board, or one of Simplify's job lists on GitHub. Jobhunt does not copy its jobs.
// It reads the site's sitemap, opens one page per company it has not seen before, and finds the employer's own board
// there, so the jobs still come from the employer. Carried over from jobleft.
import { getJson, getText, NotFound, obj, str } from "./http";
import { getSecret } from "./secrets";
import { detectBoard } from "./sources";
import { addCollection, addCollectionBoard, collectionPages, getProfile, listCollections, recordCollectionCheck, saveCollectionPage, setCollectionNotRead } from "./store";
import { decodeEntities } from "./text";
import type { Ats, Collection } from "./types";

/** Most company pages one check may open (one request a second to the collection's host). */
const PAGE_CAP = 3000;
const WEEK = 7 * 86_400_000;
/** Path words that name a company page on a collection ("/jobs/<company>", "/companies/<company>"). */
const SECTIONS = ["jobs", "company", "companies", "portfolio", "careers"];

type Found = { ats: Exclude<Ats, "manual">; slug: string; company: string };

function sitemapLocs(xml: string): { locs: string[]; index: boolean } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  return { locs, index: /<sitemapindex[\s>]/i.test(xml) };
}

/**
 * The pages to read, one per company, keyed by the company's name in the address. A site that lists its job pages
 * ("/companies/<company>/jobs/<id>", the Getro boards of Techstars, Accel and Foundry) is read through one job page
 * per company, the newest: job pages carry the employer's own apply link. Otherwise the company pages are read.
 */
function companyPages(locs: string[], site: URL): Map<string, string> {
  const best = new Map<string, { url: string; rank: number }>();
  const jobPage = new Map<string, { url: string; n: number }>();
  for (const loc of locs) {
    let u: URL;
    try { u = new URL(loc); } catch { continue; }
    if (u.host.toLowerCase() !== site.host.toLowerCase()) continue;
    const seg = u.pathname.split("/").filter(Boolean);
    const rank = SECTIONS.indexOf((seg[0] ?? "").toLowerCase());
    if (rank < 0) continue;
    let key: string;
    try { key = decodeURIComponent(seg[1] ?? "").toLowerCase(); } catch { continue; }
    if (!key) continue;
    if (seg.length >= 4 && seg[2].toLowerCase() === "jobs") {
      const n = Number(/^(\d+)/.exec(seg[3] ?? "")?.[1] ?? 0);
      const had = jobPage.get(key);
      if (!had || n > had.n) jobPage.set(key, { url: `${u.origin}${u.pathname}`, n });
      continue;
    }
    if (seg.length !== 2) continue;
    const had = best.get(key);
    if (!had || rank < had.rank) best.set(key, { url: `${u.origin}${u.pathname}`, rank });
  }
  const from = jobPage.size > 0 ? jobPage : best;
  return new Map([...from].slice(0, PAGE_CAP).map(([key, v]) => [key, v.url]));
}

function companyName(html: string): string {
  // The employer named in the page's own data (Getro: "organization": { ..., "name": "Zipline" }).
  const data = /"organization"\s*:\s*\{[^{}]*?"name"\s*:\s*"([^"]{1,120})"/.exec(html)?.[1];
  if (data) return data.replace(/\\u0026/g, "&").trim();
  const og = /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i.exec(html)?.[1];
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? og ?? "").replace(/\s+/g, " ").trim();
  // "Jobs at EliseAI | Andreessen Horowitz" reads "EliseAI".
  const name = title.split(/\s+[|–—-]\s+/)[0].replace(/^(?:open\s+)?(?:jobs|careers|positions|roles)\s+(?:at|with)\s+/i, "").replace(/\s+(?:jobs|careers|open roles)$/i, "").trim();
  return name.length <= 120 && !/^(?:jobs|careers|companies)$/i.test(name) ? name : "";
}

/** The employer board a company or job page links most, or null when it links none Jobhunt can read. */
function boardOnPage(html: string): Found | null {
  const counts = new Map<string, { found: Omit<Found, "company">; n: number }>();
  // Links in the page, and links inside its embedded data, where the slashes are escaped.
  for (const m of html.matchAll(/https?:\\?\/\\?\/[A-Za-z0-9.-]+(?:\\?\/[A-Za-z0-9._~%-]+){1,8}/g)) {
    const d = detectBoard(m[0].replace(/\\\//g, "/"));
    if (!d) continue;
    const key = `${d.ats}:${d.slug.toLowerCase()}`;
    const had = counts.get(key);
    if (had) had.n++; else counts.set(key, { found: d, n: 1 });
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return top ? { ...top.found, company: companyName(html) } : null;
}

async function sitePages(site: URL): Promise<Map<string, string>> {
  const first = sitemapLocs(await getText(`${site.origin}/sitemap.xml`));
  let locs = first.locs;
  if (first.index) {
    // The company and job parts of a sitemap index first; the rest only when the index is small.
    const score = (u: string) => (/compan/i.test(u) ? 0 : /job/i.test(u) ? 1 : 2);
    const parts = [...first.locs].sort((a, b) => score(a) - score(b)).filter((u) => score(u) < 2 || first.locs.length <= 40).slice(0, 40);
    locs = [];
    for (const part of parts) {
      try { locs.push(...sitemapLocs(await getText(part)).locs); } catch { /* one part missing does not stop the rest */ }
    }
  }
  return companyPages(locs, site);
}

/** One of Simplify's lists on GitHub: every active row's apply link, read from the list's own data file. */
async function simplifyBoards(repo: string): Promise<Found[]> {
  const rows = await getJson(`https://raw.githubusercontent.com/SimplifyJobs/${repo}/dev/.github/scripts/listings.json`, 180_000);
  if (!Array.isArray(rows)) throw new Error("The list's data file is not a list of postings.");
  const out = new Map<string, Found>();
  for (const r of rows.map(obj)) {
    if (r.active === false || r.is_visible === false) continue;
    const d = detectBoard(str(r.url));
    if (d) out.set(`${d.ats}:${d.slug.toLowerCase()}`, { ...d, company: str(r.company_name) });
  }
  return [...out.values()];
}

const g = globalThis as unknown as { __jobhuntChecking?: Set<string> };
const checking = () => (g.__jobhuntChecking ??= new Set<string>());

/** Reads one collection's site for employers that are new to it. Returns how many boards were added. */
export async function checkCollection(c: Pick<Collection, "id" | "url" | "name">): Promise<number> {
  if (checking().has(c.id)) return 0;
  checking().add(c.id);
  let added = 0;
  try {
    if (c.id === REED_COLLECTION) return (added = await reedBoards(c));
    if (/(?:^|\.)campusmesh\.com$/i.test(new URL(c.url).host)) return (added = await campusmeshBoards(c));
    const site = new URL(c.url);
    const simplify = site.host === "github.com" ? /^\/SimplifyJobs\/([\w.-]+)/i.exec(site.pathname)?.[1] : null;
    if (simplify) {
      recordCollectionCheck(c.id, "Reading the list…", false);
      const found = await simplifyBoards(simplify);
      for (const f of found) if (addCollectionBoard(c.id, f.ats, f.slug, f.company || f.slug)) added++;
      recordCollectionCheck(c.id, `${found.length.toLocaleString()} employer boards on the list, ${added} new.`, true);
      return added;
    }
    recordCollectionCheck(c.id, "Reading the site's list of companies…", false);
    const pages = await sitePages(site);
    const read = collectionPages(c.id);
    const todo = [...pages].filter(([key]) => !read.has(key));
    let done = 0;
    for (const [key, url] of todo) {
      let board = "";
      try {
        const f = boardOnPage(await getText(url));
        if (f) {
          board = `${f.ats}:${f.slug}`;
          if (addCollectionBoard(c.id, f.ats, f.slug, f.company || key)) added++;
        }
      } catch (e) {
        // A page that is gone is remembered as read; any other failure is tried again on the next check.
        if (!(e instanceof NotFound)) { done++; continue; }
      }
      saveCollectionPage(c.id, key, board);
      if (++done % 20 === 0) recordCollectionCheck(c.id, `Reading company pages: ${done} of ${todo.length}, ${added} new boards so far…`, false);
    }
    recordCollectionCheck(c.id, `${pages.size.toLocaleString()} companies listed, ${todo.length} new to Jobhunt, ${added} new boards.`, true);
    return added;
  } catch (e) {
    recordCollectionCheck(c.id, `The check failed: ${e instanceof Error ? e.message : String(e)}`, false);
    return added;
  } finally {
    checking().delete(c.id);
  }
}

export const isChecking = (id: string): boolean => checking().has(id);

// ---------------------------------------------------------------- CampusMesh

// campusmesh.com/jobs lists jobs and internships for students, each with the employer's own posting as its link. Its
// public list is read through the API its page uses (500 jobs a request); each link names the employer's board.
// Where the link is a posting on the employer's own website, the provider CampusMesh names and its company name are
// tried as the board instead, checked with one request per employer and remembered.
const CAMPUSMESH = "https://api.campusmesh.com/jobs-service/jobs/public/list";
// Only employers with a job for students or new graduates on CampusMesh are followed: its list runs to well over
// a hundred thousand jobs from thousands of employers, and following every one would triple what Jobhunt reads.
const STUDENT_TITLE = /\b(?:intern(?:ship)?s?|co-?op|new[- ]?grad(?:uate)?s?|graduates?|grad(?:uate)?\s+(?:program|scheme|trainee)|entry[- ]level|junior|jr\.?|trainees?|apprentice(?:ship)?s?|early[- ]career|campus|students?|fellow(?:ship)?s?|rotational|(?:engineer|analyst|developer|scientist|associate|specialist|technician|accountant|consultant)\s+(?:i|1)|level\s+(?:i|1))\b/i;

/** A CampusMesh job meant for students or new graduates: by its title, or by asking for no experience. */
export function studentFriendly(j: { title?: unknown; experienceYearsMin?: unknown; employmentType?: unknown }): boolean {
  const years = typeof j.experienceYearsMin === "number" ? j.experienceYearsMin : null;
  return STUDENT_TITLE.test(str(j.title)) || /intern/i.test(str(j.employmentType)) || (years !== null && years <= 1);
}

// About half of CampusMesh's list is for students, from some five thousand employers, many of them hospitals,
// shops and trades. Followed are the employers with a student job in the United States in the professional fields
// people here look for: about 2,500 boards.
const FIELD = /\b(?:software|data|engineer(?:ing)?|developer|analyst|analytics|machine\s+learning|ml|ai|cloud|devops|security|cyber|product|it|systems|research|quantitative|quant|finance|financial|accounting|business|marketing|design|ux|ui|consulting|strategy|operations\s+research|actuarial|economics)\b/i;

/** A CampusMesh job that makes its employer worth following: for students, in the US, in a professional field. */
export function campusmeshFits(j: { title?: unknown; experienceYearsMin?: unknown; employmentType?: unknown; country?: unknown }): boolean {
  return studentFriendly(j) && str(j.country).toUpperCase() === "US" && FIELD.test(str(j.title));
}

const READABLE: ReadonlySet<string> = new Set(["greenhouse", "lever", "ashby", "workable", "workday", "smartrecruiters", "teamtailor", "personio", "bamboohr", "jazzhr", "icims", "oracle"]);

async function boardExists(ats: string, slug: string): Promise<boolean> {
  try {
    if (ats === "greenhouse") return Array.isArray(obj(await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`)).jobs);
    if (ats === "workable") return Array.isArray(obj(await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`)).jobs);
    if (ats === "lever") return Array.isArray(await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json&limit=1`));
    if (ats === "ashby") return Array.isArray(obj(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`)).jobs);
    if (ats === "teamtailor") return /<rss[\s>]/.test(await getText(`https://${slug}/jobs.rss`));
  } catch {
    // Not a board.
  }
  return false;
}

async function campusmeshBoards(c: Pick<Collection, "id">): Promise<number> {
  const jobs: Array<Record<string, unknown>> = [];
  // The API answers up to 100 jobs a request whatever is asked for: the next request starts where this one ended.
  for (let offset = 0; offset < 400_000;) {
    const body = obj(obj(await getJson(`${CAMPUSMESH}?limit=100&offset=${offset}`, 120_000)).data);
    if (!Array.isArray(body.jobs)) throw new Error("CampusMesh's answer has no job list; the site may have changed, so nothing was read.");
    jobs.push(...body.jobs.map(obj));
    offset += body.jobs.length;
    if (jobs.length % 2000 < 100) recordCollectionCheck(c.id, `Reading CampusMesh's list: ${jobs.length.toLocaleString()} of ${Number(body.totalJobCount ?? 0).toLocaleString()} jobs…`, false);
    if (!body.jobs.length || body.hasNext === false) break;
  }
  const seen = collectionPages(c.id);
  const found = new Map<string, Found>();
  const tryLater = new Map<string, { ats: string; slug: string; company: string }>();
  const notRead: Record<string, number> = {};
  let skipped = 0;
  for (const j of jobs) {
    if (!campusmeshFits({ ...j, country: obj(j.location).country })) { skipped++; continue; }
    const url = str(j.primaryUrl);
    const source = str(j.source).toLowerCase();
    const company = str(obj(j.company).name);
    const d = detectBoard(url);
    if (d) { found.set(`${d.ats}:${d.slug.toLowerCase()}`, { ...d, company: company || d.slug }); continue; }
    if (!READABLE.has(source)) { notRead[source || "other"] = (notRead[source || "other"] ?? 0) + 1; continue; }
    // A posting on the employer's own site: its provider's board under the company's name, or for Teamtailor the
    // careers site's own host.
    let slug = source === "teamtailor" ? (() => { try { return new URL(url).host.toLowerCase(); } catch { return ""; } })() : company.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!slug) continue;
    if (!["greenhouse", "workable", "lever", "ashby", "teamtailor"].includes(source)) { notRead[source] = (notRead[source] ?? 0) + 1; continue; }
    slug = slug.slice(0, 100);
    tryLater.set(`${source}:${slug}`, { ats: source, slug, company });
  }
  let added = 0;
  for (const f of found.values()) if (addCollectionBoard(c.id, f.ats, f.slug, f.company)) added++;
  let tried = 0;
  for (const [key, t] of tryLater) {
    const page = `campusmesh:${key}`;
    if (seen.has(page)) { const b = seen.get(page); if (b) found.set(key, { ats: t.ats as Found["ats"], slug: t.slug, company: t.company }); continue; }
    const ok = await boardExists(t.ats, t.slug);
    saveCollectionPage(c.id, page, ok ? key : "");
    if (ok) { found.set(key, { ats: t.ats as Found["ats"], slug: t.slug, company: t.company }); if (addCollectionBoard(c.id, t.ats as Found["ats"], t.slug, t.company)) added++; }
    if (++tried % 20 === 0) recordCollectionCheck(c.id, `Checking employers' own boards: ${tried} of ${tryLater.size}…`, false);
  }
  setCollectionNotRead(c.id, notRead);
  recordCollectionCheck(c.id, `${(jobs.length - skipped).toLocaleString()} of CampusMesh's ${jobs.length.toLocaleString()} jobs are US student and new-graduate jobs in professional fields, from ${found.size.toLocaleString()} employer boards Jobhunt reads; ${added} new.`, true);
  return added;
}

// ---------------------------------------------------------------- Reed

// Reed's official job search API (a free key from reed.co.uk/developers, kept with the other API keys (src/lib/secrets.ts)). Reed's own listings
// are not used: for each employer found, one of its jobs is opened to see where it is applied for, and when that is
// the employer's own board on a provider Jobhunt reads, the board is followed. Agencies, and employers that take
// applications on Reed itself, are skipped.
export const REED_COLLECTION = "reed-employers";
const REED = "https://www.reed.co.uk/api/1.0";
const REED_DEFAULT_SEARCHES = ["software engineer", "data analyst", "data engineer", "developer", "graduate", "product manager", "analyst"];
/** Job pages opened on one check: one per employer not seen before. */
const REED_DETAILS = 400;

async function reedBoards(c: Pick<Collection, "id">): Promise<number> {
  const key = getSecret("reed");
  if (!key) {
    recordCollectionCheck(c.id, "Add a Reed API key in Settings to find UK employers through Reed.", false);
    return 0;
  }
  const auth = { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
  const titles = getProfile().targetTitles;
  const searches = titles.length ? titles : REED_DEFAULT_SEARCHES;
  const seen = collectionPages(c.id);
  // One job per employer, the newest: its page says where applications go.
  const employers = new Map<string, { jobId: string; name: string }>();
  for (const words of searches) {
    for (let skip = 0; skip < 500; skip += 100) {
      recordCollectionCheck(c.id, `Searching Reed for “${words}”…`, false);
      const body = obj(await getJson(`${REED}/search?keywords=${encodeURIComponent(words)}&resultsToTake=100&resultsToSkip=${skip}`, 45_000, auth));
      const results = Array.isArray(body.results) ? body.results.map(obj) : [];
      for (const r of results) {
        const employer = String(r.employerId ?? "");
        const jobId = String(r.jobId ?? "");
        if (!employer || !jobId || seen.has(`reed:${employer}`) || employers.has(employer)) continue;
        employers.set(employer, { jobId, name: str(r.employerName) });
      }
      if (results.length < 100) break;
    }
  }
  let added = 0, done = 0, boards = 0;
  for (const [employer, { jobId, name }] of [...employers].slice(0, REED_DETAILS)) {
    let board = "";
    try {
      const job = obj(await getJson(`${REED}/jobs/${encodeURIComponent(jobId)}`, 45_000, auth));
      const f = detectBoard(str(job.externalUrl));
      if (f) {
        board = `${f.ats}:${f.slug}`;
        boards++;
        if (addCollectionBoard(c.id, f.ats, f.slug, name || f.slug)) added++;
      }
    } catch (e) {
      if (!(e instanceof NotFound)) throw e;
    }
    // Remembered either way: an employer that applies through Reed or an agency's site is not opened again.
    saveCollectionPage(c.id, `reed:${employer}`, board);
    if (++done % 25 === 0) recordCollectionCheck(c.id, `Opening one job per employer: ${done} of ${Math.min(employers.size, REED_DETAILS)}, ${added} new boards so far…`, false);
  }
  recordCollectionCheck(c.id, `${employers.size.toLocaleString()} employers new to Jobhunt on Reed, ${boards} with their own board, ${added} new boards.`, true);
  return added;
}

/** Checks every switched-on collection that has a site of its own and was last read more than a week ago. */
export async function checkDueCollections(): Promise<number> {
  const due = listCollections().filter((c) => c.enabled && !c.fixed && c.url && (!c.lastCheckedAt || Date.now() - Date.parse(c.lastCheckedAt) > WEEK));
  // Each collection is a different site, so they are read side by side.
  const added = await Promise.all(due.map((c) => checkCollection(c)));
  return added.reduce((n, x) => n + x, 0);
}

/** Follows a new collection by its address: a portfolio job board, or a SimplifyJobs list on GitHub. */
export function followCollection(input: string): { id: string; name: string; url: string } {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`); } catch { throw new Error("That is not a web address."); }
  const host = u.host.toLowerCase().replace(/^www\./, "");
  if (detectBoard(u.href)) throw new Error("That is one employer's board, not a collection. Add it under “Or paste a careers link”.");
  let id = host;
  let name = host;
  let url = `${u.origin}/`;
  if (host === "github.com") {
    const [owner, repo] = u.pathname.split("/").filter(Boolean);
    if (!owner || !repo || owner.toLowerCase() !== "simplifyjobs") throw new Error("On GitHub, Jobhunt reads the SimplifyJobs lists, for example github.com/SimplifyJobs/New-Grad-Positions.");
    id = `github-${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
    name = `Simplify: ${repo.replace(/-/g, " ")}`;
    url = `https://github.com/${owner}/${repo}`;
  }
  addCollection(id, name, url);
  return { id, name, url };
}
