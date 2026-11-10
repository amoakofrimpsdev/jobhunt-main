// Employers' own careers sites built on hiring systems that publish no job feed (Taleo behind Radancy, Phenom,
// SAP SuccessFactors, and others): Kaiser Permanente, Duke, MD Anderson, Sutter Health and the like. Such a site
// lists its job pages in its sitemap, the way it asks search engines to find them, and each job page describes the
// job in schema.org markup. A board is the site's host ("www.kaiserpermanentejobs.org"). Pages its robots.txt keeps
// out are never asked for. As with Meta, a job is first saved from its address (title and place) and read in full
// on this run or a later one.
import { getText, iso } from "./http";
import { base, heading, incremental, jobPostingOf, SITE_LIMITS, text, withJobPosting, type Detail, type Row } from "./sources-more";
import type { Listing } from "./sources";
import { decodeEntities } from "./text";
import type { RawJob } from "./types";

const MAX_SITEMAPS = 40;
/** Job pages: a "job" segment in the address and an id among its parts. */
const JOB_PATH = /\/(?:job|jobs|jobdetails?|job-details?|posting)\//i;

function hostOf(slug: string): string {
  const h = slug.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(h)) throw new Error(`"${slug}" is not a careers site address.`);
  return h;
}

/** The paths robots.txt keeps every crawler out of ("User-agent: *"), as patterns with * and a closing $. */
export function robotsRules(txt: string): { disallow: RegExp[]; sitemaps: string[] } {
  const disallow: RegExp[] = [];
  const sitemaps: string[] = [];
  let forAll = false;
  let inAgents = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const [key, value] = [m[1].toLowerCase(), m[2].trim()];
    if (key === "sitemap") { if (/^https?:\/\//i.test(value)) sitemaps.push(value); continue; }
    if (key === "user-agent") { forAll = inAgents ? forAll || value === "*" : value === "*"; inAgents = true; continue; }
    inAgents = false;
    if (key === "disallow" && forAll && value && (value.startsWith("/") || value.startsWith("*"))) {
      // "*" matches anything; a closing "$" anchors the end; everything else is literal.
      const anchored = value.endsWith("$");
      const body = (anchored ? value.slice(0, -1) : value).split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
      disallow.push(new RegExp(`^${body}${anchored ? "$" : ""}`));
    }
  }
  return { disallow, sitemaps };
}

const allowed = (url: string, disallow: RegExp[]) => {
  try { const u = new URL(url); return !disallow.some((re) => re.test(u.pathname + u.search)); } catch { return false; }
};

/** The id of a job page (its longest path segment with digits in it) and a title and place made from its address. */
export function jobFromAddress(url: string): { id: string; title: string; place: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!JOB_PATH.test(u.pathname)) return null;
  const seg = u.pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const withDigits = seg.filter((s) => /\d/.test(s) && s.length >= 4 && !/^(?:19|20)\d\d$/.test(s));
  if (!withDigits.length) return null;
  // The id: the longest segment with digits that is not mostly words ("Durham-Postdoctoral-Associate-NC-27710" is a title).
  const ids = withDigits.filter((s) => (s.match(/[a-z]/gi)?.length ?? 0) < 12);
  const idSeg = (ids.length ? ids : withDigits).reduce((a, b) => (b.length >= a.length ? b : a));
  const id = idSeg.replace(/[^\w.-]/g, "").slice(0, 80);
  const isWords = (s: string) => s !== idSeg && /[a-z]{3,}/i.test(s) && (s.match(/[a-z]/gi)?.length ?? 0) >= 4
    && !/^(?:job|jobs|jobdetails?|job-details?|search|posting|en|us|en-us|careers?)$/i.test(s) && (s.match(/\d/g)?.length ?? 0) < (s.match(/[a-z]/gi)?.length ?? 0);
  const human = (s: string) => s.replace(/-[A-Z]{2}-\d{5}$/, "").replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
  const at = seg.indexOf(idSeg);
  // Phenom and most others: /job/<id>/<title>. Radancy: /job/<city>/<title>/<company>/<id>. SuccessFactors: /job/<title>/<id>/.
  const after = seg.slice(at + 1).find(isWords);
  const before = seg.slice(0, at).filter(isWords);
  const titleSeg = after ?? before[before.length - 1] ?? "";
  const place = !after && before.length >= 2 ? human(before[before.length - 2]) : "";
  return { id, title: titleSeg ? human(titleSeg) : "", place };
}

/** The inside of the element that starts at `start`, nested elements of the same name included. */
function innerOf(html: string, start: number): string {
  const open = /^<([a-z0-9]+)\b[^>]*>/i.exec(html.slice(start));
  if (!open) return "";
  const tag = open[1].toLowerCase();
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start + open[0].length;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start + open[0].length, m.index);
  }
  return "";
}

/** The job's own words on a page without a JobPosting: schema.org microdata (SAP SuccessFactors) or its summary. */
function fromMicrodata(row: Row, html: string): RawJob | null {
  const prop = (name: string) => {
    const at = new RegExp(`<[a-z0-9]+\\b[^>]*itemprop=["']${name}["']`, "i").exec(html);
    return at ? innerOf(html, at.index) : "";
  };
  const meta = (name: string) => new RegExp(`<meta[^>]+(?:itemprop|property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i").exec(html)?.[1] ?? "";
  const description = prop("description");
  // Without the job's own text (a posting that has closed but is still in the sitemap shows only a one-line
  // summary) the job stays as its address describes it.
  if (text(description).length < 200) return null;
  const title = text(prop("title")) || text(decodeEntities(meta("og:title"))) || row.fromList.title;
  const where = [meta("addressLocality"), meta("addressRegion"), meta("addressCountry")].filter(Boolean).join(", ");
  const place = where || text(prop("address")) || row.fromList.location;
  return { ...row.fromList, title, location: place, descriptionHtml: description, postedAt: iso(meta("datePosted")) ?? row.fromList.postedAt };
}

export function careersiteDetail(company: string): Detail {
  return async (row) => {
    const html = await getText(row.fromList.url);
    const ld = jobPostingOf(html);
    if (ld) {
      const job = withJobPosting(row.fromList, ld, false);
      const extra = ["responsibilities", "qualifications", "educationRequirements", "experienceRequirements"]
        .map((k) => (typeof ld[k] === "string" && (ld[k] as string).trim() ? heading(k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), ld[k] as string) : "")).join("");
      return { ...job, company: company || job.company, descriptionHtml: `${job.descriptionHtml}${extra}` };
    }
    const micro = fromMicrodata(row, html);
    return micro ? { ...micro, company } : null;
  };
}

export async function careersite(slug: string, company: string, known: Set<string>): Promise<Listing> {
  const host = hostOf(slug);
  const started = Date.now();
  let robots = "";
  try { robots = await getText(`https://${host}/robots.txt`); } catch { /* none: everything is allowed */ }
  const rules = robotsRules(robots);
  const queue = rules.sitemaps.length ? [...rules.sitemaps] : [`https://${host}/sitemap.xml`];
  const seenMaps = new Set<string>();
  const rows = new Map<string, Row>();
  let complete = true;
  while (queue.length) {
    const map = queue.shift()!;
    if (seenMaps.has(map)) continue;
    if (seenMaps.size >= MAX_SITEMAPS || Date.now() - started > SITE_LIMITS.ms / 2) { complete = false; break; }
    seenMaps.add(map);
    let xml: string;
    try { xml = await getText(map, 120_000); } catch { complete = false; continue; }
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
    if (/<sitemapindex[\s>]/i.test(xml)) {
      // Job sitemaps first; pages about the employer are not needed.
      queue.unshift(...locs.filter((l) => /job|posting|position|requisition/i.test(l)));
      queue.push(...locs.filter((l) => !/job|posting|position|requisition/i.test(l) && !/blog|news|event|article|location|categor|page-sitemap|post-sitemap/i.test(l)));
      continue;
    }
    for (const loc of locs) {
      // Only the site's own pages: a sitemap must not send the app to other hosts or the local network.
      try { const u = new URL(loc); if (u.protocol !== "https:" || u.host !== host) continue; } catch { continue; }
      if (!allowed(loc, rules.disallow)) continue;
      const j = jobFromAddress(loc);
      if (!j || rows.has(j.id)) continue;
      const job = base(j.id, loc, j.title, company, j.place);
      rows.set(j.id, { id: j.id, fromList: job });
    }
  }
  if (!rows.size) throw new Error("No job pages were found in this site's sitemap, so nothing was read.");
  return incremental([...rows.values()], known, started, !complete, careersiteDetail(company), SITE_LIMITS);
}
