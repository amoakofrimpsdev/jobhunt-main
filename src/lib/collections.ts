// Re-reading a collection's own site for employers it has added. A collection is a site that lists many employers'
// jobs: a venture firm's portfolio board, or one of Simplify's job lists on GitHub. Jobhunt does not copy its jobs.
// It reads the site's sitemap, opens one page per company it has not seen before, and finds the employer's own board
// there, so the jobs still come from the employer. Carried over from jobleft.
import { getJson, getText, NotFound, obj, str } from "./http";
import { detectBoard } from "./sources";
import { addCollection, addCollectionBoard, collectionPages, listCollections, recordCollectionCheck, saveCollectionPage } from "./store";
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
