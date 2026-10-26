// Readers for providers common among UK employers: SmartRecruiters, Personio and Teamtailor, which each serve an
// employer's own careers page, and NHS Jobs, where NHS trusts and practices post their own vacancies. Each posting
// links to the employer's own advert.
import { getJson, getText, iso, num, obj, str } from "./http";
import { base, distinct, heading, incremental, notAfterNow, place, SITE_LIMITS, subdomain, text, type Detail, type Row } from "./sources-more";
import type { Listing } from "./sources";
import { decodeEntities } from "./text";
import type { PayPeriod, RawJob, WorkModel } from "./types";

const mode = (v: string): WorkModel | null => {
  const t = v.toLowerCase().replace(/[^a-z]/g, "");
  return t === "remote" || t === "fullyremote" ? "remote" : t === "hybrid" ? "hybrid" : t === "onsite" || t === "office" || t === "none" ? "onsite" : null;
};
const typeOf = (v: string): string | null => {
  const t = v.toLowerCase();
  return /intern/.test(t) ? "Internship" : /part/.test(t) ? "Part-time" : /contract|temporary|fixed/.test(t) ? "Contract" : /full|permanent/.test(t) ? "Full-time" : null;
};
/** The text inside one XML element, CDATA unwrapped. */
const tag = (xml: string, name: string): string => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim() : "";
};
const tags = (xml: string, name: string): string[] =>
  [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim());

// ---------------------------------------------------------------- SmartRecruiters

// The public Posting API that SmartRecruiters careers pages read: a list (100 a request) and one request per posting
// for its text. A board is the company's identifier ("Wise"). Every employer is served from one host.
const SMARTRECRUITERS = "https://api.smartrecruiters.com/v1/companies";
const SMARTRECRUITERS_CAP = 3000;

function smartrecruitersId(slug: string): string {
  const s = slug.trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(s)) throw new Error(`"${slug}" is not a SmartRecruiters company identifier.`);
  return s;
}

export function smartrecruitersDetail(slug: string): Detail {
  const id = smartrecruitersId(slug);
  return async (row) => {
    const p = obj(await getJson(`${SMARTRECRUITERS}/${encodeURIComponent(id)}/postings/${encodeURIComponent(row.id)}`));
    const sections = obj(obj(p.jobAd).sections);
    const part = (k: string) => { const s = obj(sections[k]); return str(s.text) ? heading(text(s.title) || k, str(s.text)) : ""; };
    const html = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"].map(part).join("");
    if (!html) return null;
    const comp = obj(p.compensation);
    const min = num(comp.min), max = num(comp.max);
    const period: PayPeriod | null = /hour/i.test(str(comp.period)) ? "hour" : /month/i.test(str(comp.period)) ? "month" : min || max ? "year" : null;
    return {
      ...row.fromList,
      applyUrl: str(p.applyUrl) || row.fromList.applyUrl,
      descriptionHtml: html,
      pay: period && (min || max) ? { min: min ?? max, max: max ?? min, currency: str(comp.currency) || "GBP", period } : null,
    };
  };
}

export async function smartrecruiters(slug: string, company: string, known: Set<string>): Promise<Listing> {
  const id = smartrecruitersId(slug);
  const started = Date.now();
  const rows = new Map<string, Row>();
  let total = -1;
  for (let offset = 0; offset < SMARTRECRUITERS_CAP; offset += 100) {
    const body = obj(await getJson(`${SMARTRECRUITERS}/${encodeURIComponent(id)}/postings?limit=100&offset=${offset}`));
    if (!Array.isArray(body.content)) throw new Error("The SmartRecruiters answer has no job list; the company identifier may be wrong, so nothing was read.");
    if (offset === 0) total = num(body.totalFound) ?? -1;
    for (const p of body.content.map(obj)) {
      const pid = str(p.id);
      const title = text(p.name);
      if (!pid || !title || rows.has(pid)) continue;
      const loc = obj(p.location);
      const where = loc.remote === true && !str(loc.city) ? "Remote" : place(loc.city, loc.region, str(loc.country).length === 2 ? str(loc.country).toUpperCase() : loc.country);
      const job = base(pid, `https://jobs.smartrecruiters.com/${encodeURIComponent(id)}/${pid}`, title, text(obj(p.company).name) || company, where);
      job.workModel = loc.remote === true ? "remote" : loc.hybrid === true ? "hybrid" : null;
      job.countryCode = str(loc.country).toUpperCase() || null;
      job.postedAt = notAfterNow(iso(str(p.releasedDate)));
      job.department = text(obj(p.department).label) || text(obj(p.function).label);
      job.employmentType = typeOf(str(obj(p.typeOfEmployment).label));
      rows.set(pid, { id: pid, fromList: job });
    }
    if (body.content.length < 100 || (total >= 0 && rows.size >= total)) break;
  }
  return incremental([...rows.values()], known, started, total >= 0 && rows.size < total, smartrecruitersDetail(slug));
}

// ---------------------------------------------------------------- Personio

// The XML feed Personio publishes for each company's careers page: every open position with its text, in one request.
// A board is the company's Personio name ("acme" for acme.jobs.personio.de).
export async function personio(slug: string, company: string): Promise<Listing> {
  const host = `${subdomain("Personio", slug)}.jobs.personio.de`;
  const xml = await getText(`https://${host}/xml?language=en`);
  if (!/<workzag-jobs[\s>]/.test(xml)) throw new Error("This is not a Personio job feed, so nothing was read.");
  const jobs: RawJob[] = [];
  for (const p of tags(xml, "position")) {
    const id = tag(p, "id");
    const title = text(decodeEntities(tag(p, "name")));
    if (!/^\d+$/.test(id) || !title) continue;
    const offices = distinct([tag(p, "office"), ...tags(tag(p, "additionalOffices"), "office")].map((o) => text(decodeEntities(o))));
    const job = base(id, `https://${host}/job/${id}?language=en`, title, text(decodeEntities(tag(p, "subcompany"))) || company, offices.join("; "));
    job.descriptionHtml = tags(tag(p, "jobDescriptions"), "jobDescription").map((d) => heading(text(decodeEntities(tag(d, "name"))), tag(d, "value"))).join("");
    job.department = text(decodeEntities(tag(p, "department")));
    job.employmentType = /intern/i.test(tag(p, "employmentType")) ? "Internship" : typeOf(`${tag(p, "schedule")} ${tag(p, "employmentType")}`);
    job.postedAt = iso(tag(p, "createdAt"));
    jobs.push(job);
  }
  return { jobs, seenIds: [], partial: false };
}

// ---------------------------------------------------------------- Teamtailor

// The RSS feed of a Teamtailor careers site: every open job with its text and places, in one request. A board is the
// site's Teamtailor name ("acme" for acme.teamtailor.com) or, for a site on the employer's own domain, that host.
export async function teamtailor(slug: string, company: string): Promise<Listing> {
  const s = slug.trim().toLowerCase();
  const host = s.includes(".") ? s : `${subdomain("Teamtailor", s)}.teamtailor.com`;
  if (!/^[a-z0-9.-]{3,120}$/.test(host)) throw new Error(`"${slug}" is not a Teamtailor careers site.`);
  const xml = await getText(`https://${host}/jobs.rss`);
  if (!/<rss[\s>]/.test(xml)) throw new Error("This is not a Teamtailor job feed, so nothing was read.");
  const jobs: RawJob[] = [];
  for (const item of tags(xml, "item")) {
    const link = text(tag(item, "link"));
    const id = /\/jobs\/(\d+)/.exec(link)?.[1] ?? "";
    const title = text(decodeEntities(tag(item, "title")));
    if (!id || !title) continue;
    const locs = tags(tag(item, "tt:locations"), "tt:location");
    const places = distinct(locs.map((l) => place(decodeEntities(tag(l, "tt:city") || tag(l, "tt:name")), decodeEntities(tag(l, "tt:country")))));
    const remote = mode(tag(item, "remoteStatus"));
    const job = base(id, link, title, company, places.join("; ") || (remote === "remote" ? "Remote" : ""));
    job.descriptionHtml = decodeEntities(tag(item, "description"));
    job.workModel = remote;
    job.department = text(decodeEntities(tag(item, "tt:department")));
    job.postedAt = notAfterNow(iso(tag(item, "pubDate")));
    const country = tag(locs[0] ?? "", "tt:country");
    job.countryCode = /united kingdom|great britain|^uk$|england|scotland|wales/i.test(country) ? "GB" : null;
    jobs.push(job);
  }
  return { jobs, seenIds: [], partial: false };
}

// ---------------------------------------------------------------- NHS Jobs

// NHS Jobs' public search feed (100 vacancies a request) and each vacancy's advert page on NHS Jobs, where the trust or
// practice publishes it and where it is applied for. One board holds all of them; each job carries its employer.
const NHS = "https://www.jobs.nhs.uk";
const NHS_PAGES = 300;

/** "£32073.00 to £39043.00", "£25272.00 a year", "£12.60 an hour". A bare "£350.00" is a day or session rate: not kept. */
function nhsPay(v: string): RawJob["pay"] {
  const n = [...v.replace(/,/g, "").matchAll(/£\s?(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (!n.length) return null;
  const period: PayPeriod | null = /hour/i.test(v) || n[0] < 100 ? "hour" : /month/i.test(v) ? "month" : /year|annum|p\.?a\.?\b/i.test(v) || n[0] >= 10_000 ? "year" : null;
  return period ? { min: Math.min(...n), max: Math.max(...n), currency: "GBP", period } : null;
}

export const nhsDetail: Detail = async (row) => {
  const html = await getText(row.fromList.url);
  const start = html.search(/<h2[^>]*>\s*Job summary\s*<\/h2>/i);
  if (start < 0) return null;
  const endAt = html.slice(start).search(/<h2[^>]*>\s*(?:Employer details|Documents to download)\s*<\/h2>/i);
  // The advert's own sections, without the page around them (the apply button and the cookie notice).
  const body = html.slice(start, endAt > 0 ? start + endAt : start + 60_000).replace(/<a[^>]*id="apply"[\s\S]*?<\/a>/gi, "");
  const posted = /id="date_posted"[^>]*>([^<]+)</i.exec(html)?.[1];
  const town = text(/id="employer_town"[^>]*>([^<]*)</i.exec(html)?.[1] ?? "");
  const pattern = text(/id="working_pattern[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? "");
  return {
    ...row.fromList,
    descriptionHtml: body,
    location: row.fromList.location || town,
    // The list's time is exact; the advert gives the day alone.
    postedAt: row.fromList.postedAt ?? iso(posted ?? ""),
    employmentType: /part/i.test(pattern) && !/full/i.test(pattern) ? "Part-time" : row.fromList.employmentType,
  };
};

export async function nhs(known: Set<string>): Promise<Listing> {
  const started = Date.now();
  const rows = new Map<string, Row>();
  let pages = 1;
  let total = -1;
  let outOfTime = false;
  for (let page = 1; page <= Math.min(pages, NHS_PAGES); page++) {
    if (Date.now() - started > SITE_LIMITS.ms / 2) { outOfTime = true; break; }
    // Newest first: the feed stops after 10,000 vacancies, so the ones it leaves out are the oldest.
    const xml = await getText(`${NHS}/api/v1/search_xml?page=${page}&limit=100&sort=publicationDateDesc`);
    if (!/<nhsJobs[\s>]/.test(xml)) throw new Error("The NHS Jobs answer is not its job feed; it may have changed, so nothing was read.");
    if (page === 1) { pages = Number(tag(xml, "totalPages")) || 1; total = Number(tag(xml, "totalResults")) || -1; }
    const items = tags(xml, "vacancyDetails");
    for (const v of items) {
      const ref = tag(v, "reference");
      const title = text(decodeEntities(tag(v, "title")));
      if (!/^[A-Za-z0-9-]{4,40}$/.test(ref) || !title || rows.has(ref)) continue;
      const where = distinct(tags(tag(v, "locations"), "location").map((l) => text(decodeEntities(l)))).join("; ");
      const job = base(ref, `${NHS}/candidate/jobadvert/${ref}`, title, text(decodeEntities(tag(v, "employer"))), where);
      job.employmentType = typeOf(tag(v, "type"));
      job.postedAt = notAfterNow(iso(tag(v, "postDate").replace(/(\.\d{3})\d+$/, "$1")));
      job.pay = nhsPay(tag(v, "salary"));
      job.countryCode = "GB";
      rows.set(ref, { id: ref, fromList: job });
    }
    if (!items.length) break;
  }
  // Vacancies past the feed's limit are still open: a list that is short of the total closes nothing.
  return incremental([...rows.values()], known, started, outOfTime || pages > NHS_PAGES || (total > 0 && rows.size < total), nhsDetail, SITE_LIMITS);
}

/** For tests: the pieces of the readers that work on text alone. */
export const forTests = { nhsPay, tag, tags };
