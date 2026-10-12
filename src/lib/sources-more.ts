// Readers for the providers that have no one-request feed: Workday, iCIMS, Oracle Recruiting, Workable, JazzHR and
// BambooHR. Carried over from jobleft. Workable answers a whole board at once; the other five list their postings
// and then need one request per posting for its text. Those are read incrementally: a posting whose text is already
// held is only marked as still listed, new postings are read in full up to a limit per run, and the rest are saved
// from the list alone and read in full on a later run. Each employer has its own host, read at one request a second.
// The last four readers are for employers that run a careers site of their own: Amazon, Microsoft, Apple and Meta.
import { arr, getJson, getText, iso, NotFound, num, obj, postJson, str } from "./http";
import { decodeEntities } from "./text";
import type { Listing } from "./sources";
import type { Ats, RawJob, WorkModel } from "./types";

/** Postings read in full on one run of one board (one request each). */
const DETAILS_PER_RUN = 60;
/** Time one board may take before it stops reading postings in full and answers with what it has. */
const WORK_MS = 150_000;

/** One employer's whole careers site holds thousands of postings: it may read more of them, for longer, on a run. */
const SITE_LIMITS = { details: 600, ms: 20 * 60_000 };

const SLOW: ReadonlySet<Ats> = new Set<Ats>(["workday", "icims", "oracle", "jazzhr", "bamboohr", "amazon", "microsoft", "apple", "meta"]);
/** A provider that needs many requests for one board. Its boards are read once a day, not on every refresh. */
export const isSlowAts = (ats: Ats): boolean => SLOW.has(ats);

const text = (v: unknown): string => (typeof v === "string" ? decodeEntities(v.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "");
const distinct = (xs: string[]) => [...new Map(xs.filter(Boolean).map((x) => [x.toLowerCase(), x])).values()];
const place = (...parts: unknown[]) => distinct(parts.map((p) => text(p))).join(", ");
const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{0,80}$/;

function subdomain(provider: string, slug: string): string {
  const s = slug.trim().toLowerCase();
  if (!SUBDOMAIN.test(s)) throw new Error(`"${slug}" is not a ${provider} board name.`);
  return s;
}

function base(id: string, url: string, title: string, company: string, location: string): RawJob {
  return {
    externalId: id, url, applyUrl: "", title, company, location, descriptionHtml: "", workModel: /^\s*remote\s*$/i.test(location) ? "remote" : null,
    employmentType: null, department: "", postedAt: null, countryCode: null, pay: null,
  };
}

type Row = { id: string; fromList: RawJob };
/** Reads one posting in full, given what the list says about it. One per provider that needs a request per posting. */
type Detail = (row: Row) => Promise<RawJob | null>;

/** Reads the new postings of a list in full, within the per-run limits. */
async function incremental(rows: Row[], known: Set<string>, started: number, partial: boolean, detail: (row: Row) => Promise<RawJob | null>, limits = { details: DETAILS_PER_RUN, ms: WORK_MS }): Promise<Listing> {
  const out: Listing = { jobs: [], seenIds: [], partial };
  let details = limits.details;
  let read = 0;
  for (const row of rows) {
    if (known.has(row.id)) { out.seenIds.push(row.id); continue; }
    if (details <= 0 || Date.now() - started > limits.ms) { out.jobs.push(row.fromList); continue; }
    details--;
    try {
      out.jobs.push((await detail(row)) ?? row.fromList);
      read++;
    } catch (e) {
      // A posting that closed between the list and its page keeps what the list says. Any other failure before a
      // single posting was read stops the board, and what it held before stays as it was; after that, the postings
      // already read are kept and the rest wait for the next run.
      if (!(e instanceof NotFound)) { if (!read) throw e; details = 0; }
      out.jobs.push(row.fromList);
    }
  }
  return out;
}

// ---------------------------------------------------------------- schema.org JobPosting (iCIMS, JazzHR job pages)

type Ld = Record<string, unknown>;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const said = (v: unknown): string => { const t = text(v); return /^unavailable$/i.test(t) ? "" : t; };

function jobPostingOf(html: string): Ld | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let d: unknown;
    try { d = JSON.parse(m[1].trim()); } catch { continue; }
    for (const x of [...list(d), ...list(obj(d)["@graph"])]) {
      const t = obj(x)["@type"];
      if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) return obj(x);
    }
  }
  return null;
}

/** The posting's own facts laid over what the list says about it. */
function withJobPosting(b: RawJob, ld: Ld, weakCompany: boolean): RawJob {
  const places: string[] = [];
  let country: string | null = null;
  for (const loc of list(ld.jobLocation)) {
    const a = obj(obj(loc).address);
    const c = said(a.addressCountry) || said(obj(a.addressCountry).name);
    const p = place(said(a.addressLocality), said(a.addressRegion), c.length === 2 ? "" : c);
    if (p) places.push(p);
    if (/^[A-Za-z]{2}$/.test(c)) country ??= c.toUpperCase();
  }
  const type = list(ld.employmentType).map((x) => String(x).toUpperCase()).join(" ");
  return {
    ...b,
    title: said(ld.title) || b.title,
    // A board known only by its address ("careers-acme") takes the employer's name from the posting itself.
    company: (b.company && !weakCompany ? b.company : said(obj(ld.hiringOrganization).name)) || b.company,
    location: distinct(places).join("; ") || b.location,
    countryCode: country ?? b.countryCode,
    descriptionHtml: typeof ld.description === "string" ? ld.description : b.descriptionHtml,
    postedAt: iso(ld.datePosted) ?? b.postedAt,
    employmentType: /INTERN/.test(type) ? "Internship" : /PART/.test(type) ? "Part-time" : /CONTRACT|TEMPORARY/.test(type) ? "Contract" : /FULL/.test(type) ? "Full-time" : b.employmentType,
    workModel: /TELECOMMUTE/i.test(String(ld.jobLocationType ?? "")) ? "remote" : b.workModel,
  };
}

/** For the providers whose job pages carry a schema.org JobPosting. */
function pageDetail(slug: string, company: string, suffix = ""): Detail {
  const weak = company.trim().toLowerCase() === slug.trim().toLowerCase();
  return async (row) => {
    const ld = jobPostingOf(await getText(`${row.fromList.url}${suffix}`));
    return ld ? withJobPosting(row.fromList, ld, weak) : null;
  };
}

// ---------------------------------------------------------------- Workday

// The career site's own job list, the one its public careers page reads. A board is "<company>.wdN.<site>".
//   List:    POST https://<company>.wdN.myworkdayjobs.com/wday/cxs/<company>/<site>/jobs   (20 a page, 2,000 at most)
//   Detail:  GET  .../wday/cxs/<company>/<site>/job/<postingId>
const WORKDAY_BOARD = /^([a-z0-9][a-z0-9-]*)\.(wd\d+)\.([a-z0-9][a-z0-9_-]{0,99})$/;
const WORKDAY_CAP = 2000;

function workdayMode(remoteType: string, places: string[]): WorkModel | null {
  const t = remoteType.toLowerCase();
  if (/hybrid/.test(t)) return "hybrid";
  if (/remote/.test(t)) return "remote";
  if (/on.?site|office/.test(t)) return "onsite";
  return places.length > 0 && places.every((p) => /\bremote\b/i.test(p)) ? "remote" : null;
}

/** "Posted Today", "Posted 3 Days Ago" as a date; "Posted 30+ Days Ago" is not a date. */
function workdayPosted(words: string): string | null {
  const t = words.toLowerCase();
  const m = /\b(\d{1,2}) days? ago\b/.exec(t);
  // "Posted 30+ Days Ago" is no exact day, but it is at least thirty days: the latest day it could have been.
  const days = /\btoday\b/.test(t) ? 0 : /\byesterday\b/.test(t) ? 1 : m ? Number(m[1]) : null;
  return days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString();
}

function workdayBoard(slug: string) {
  const m = WORKDAY_BOARD.exec(slug.trim().toLowerCase());
  if (!m) throw new Error(`"${slug}" is not a Workday board: it should read company.wd5.site.`);
  const [, tenant, wd, site] = m;
  const host = `${tenant}.${wd}.myworkdayjobs.com`;
  return { host, site, api: `https://${host}/wday/cxs/${tenant}/${site}` };
}

function workdayDetail(slug: string, company: string): Detail {
  const { api } = workdayBoard(slug);
  // A board known only by its address, or by a bare abbreviation ("UW"), takes the employer's name from the posting.
  const weak = !company || company.toLowerCase() === slug.toLowerCase() || (!company.includes(" ") && company.length <= 4);
  return async (row) => {
    const body = obj(await getJson(`${api}/job/${encodeURIComponent(row.id)}`));
    const i = obj(body.jobPostingInfo);
    const places = distinct([text(i.location), ...arr(i.additionalLocations).map(text)]);
    const org = text(obj(body.hiringOrganization).name).replace(/^\s*(?=[A-Za-z]*\d{3})[A-Za-z0-9]+\s+(?=\S)/, "");
    const time = str(i.timeType).toLowerCase();
    return {
      ...row.fromList,
      title: text(i.title) || row.fromList.title,
      company: weak && org ? org : company,
      location: places.join("; ") || row.fromList.location,
      descriptionHtml: str(i.jobDescription),
      workModel: workdayMode(str(i.remoteType), places),
      countryCode: str(obj(obj(i.jobRequisitionLocation).country).alpha2Code) || str(obj(i.country).alpha2Code) || null,
      postedAt: iso(str(i.startDate)) ?? row.fromList.postedAt,
      employmentType: /part/.test(time) ? "Part-time" : /full/.test(time) ? "Full-time" : null,
    };
  };
}

async function workday(slug: string, company: string, known: Set<string>): Promise<Listing> {
  const { host, site, api } = workdayBoard(slug);
  const started = Date.now();
  const rows = new Map<string, Row>();
  let total = -1;
  let outOfTime = false;
  for (let offset = 0; offset < WORKDAY_CAP; offset += 20) {
    // A slow site: stop paging with time left to save what was read. A partial list closes nothing.
    if (offset > 0 && Date.now() - started > WORK_MS) { outOfTime = true; break; }
    const body = obj(await postJson(`${api}/jobs`, { appliedFacets: {}, limit: 20, offset, searchText: "" }));
    if (!Array.isArray(body.jobPostings)) throw new Error("The Workday answer has no job list; the career site may have changed, so nothing was read.");
    if (offset === 0) total = num(body.total) ?? -1;
    let fresh = 0;
    for (const p of body.jobPostings.map(obj)) {
      const path = str(p.externalPath);
      const seg = path.split("/").filter(Boolean);
      const id = seg[0] === "job" && seg.length >= 2 ? seg[seg.length - 1] : "";
      const title = text(p.title);
      if (!id || !title || rows.has(id)) continue;
      const where = text(p.locationsText);
      const job = base(id, `https://${host}/${site}${path}`, title, company, /^\d+\s+locations?$/i.test(where) ? "" : where);
      job.postedAt = workdayPosted(str(p.postedOn));
      rows.set(id, { id, fromList: job });
      fresh++;
    }
    if (body.jobPostings.length < 20 || fresh === 0 || (total >= 0 && rows.size >= total)) break;
  }
  // Workday reports 2,000 when there are more, and a short count means a page was lost: either way the list is partial.
  const partial = outOfTime || total >= WORKDAY_CAP || (total >= 0 && rows.size < total);
  return incremental([...rows.values()], known, started, partial, workdayDetail(slug, company));
}

// ---------------------------------------------------------------- Workable

// The public account endpoint Workable documents for building a careers page: the whole board in one request.
async function workable(slug: string, company: string): Promise<Listing> {
  if (!/^[A-Za-z0-9._-]+$/.test(slug.trim())) throw new Error(`"${slug}" is not a Workable board name.`);
  const account = obj(await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug.trim())}?details=true`));
  if (!Array.isArray(account.jobs)) throw new Error("The Workable answer has no job list; the feed may have changed, so nothing was read.");
  // Workable lists a job once per location under one shortcode: that is one posting with several places.
  const byId = new Map<string, RawJob>();
  for (const j of account.jobs.map(obj)) {
    const id = str(j.shortcode) || (typeof j.id === "number" ? String(j.id) : str(j.id));
    const title = text(j.title);
    if (!id || !title) continue;
    const locs = arr(j.locations).map(obj);
    // A location marked hidden shows only its country: the employer chose not to publish the city.
    const where = distinct(locs.map((l) => (l.hidden === true ? text(l.country) : place(l.city, l.region ?? l.state, l.country)))).join("; ") || place(j.city, j.state, j.country);
    const first = byId.get(id);
    if (first) { first.location = distinct([...first.location.split("; "), ...where.split("; ")]).join("; "); continue; }
    const mode = str(j.workplace_type).toLowerCase().replace(/[^a-z]/g, "");
    const job = base(id, str(j.url) || str(j.shortlink) || `https://apply.workable.com/${encodeURIComponent(slug.trim())}/j/${encodeURIComponent(id)}/`, title, text(account.name) || company, where);
    job.applyUrl = str(j.application_url);
    job.descriptionHtml = `${str(j.description)}${str(j.requirements) ? `<h3>Requirements</h3>${str(j.requirements)}` : ""}${str(j.benefits) ? `<h3>Benefits</h3>${str(j.benefits)}` : ""}`;
    job.workModel = mode === "remote" ? "remote" : mode === "hybrid" ? "hybrid" : mode === "onsite" ? "onsite" : j.telecommuting === true ? "remote" : null;
    job.employmentType = str(j.employment_type) || str(j.type) || null;
    job.department = text(j.department);
    job.postedAt = iso(j.published_on);
    job.countryCode = str(locs[0]?.countryCode ?? locs[0]?.country_code) || null;
    byId.set(id, job);
  }
  return { jobs: [...byId.values()], seenIds: [], partial: false };
}

// ---------------------------------------------------------------- iCIMS

// Career sites at https://<name>.icims.com: the public search pages (50 postings a page) and each job's page, which
// carries a schema.org JobPosting.
const ICIMS_MAX_PAGES = 40;

async function icims(slug: string, company: string, known: Set<string>): Promise<Listing> {
  const host = `${subdomain("iCIMS", slug)}.icims.com`;
  const started = Date.now();
  const rows = new Map<string, Row>();
  let pages = 1;
  for (let page = 0; page < Math.min(pages, ICIMS_MAX_PAGES); page++) {
    const html = await getText(`https://${host}/jobs/search?pr=${page}&in_iframe=1`);
    if (page === 0) {
      pages = Math.max(1, Number(/Page\s+\d+\s+of\s+(\d+)/i.exec(html.replace(/<[^>]+>/g, " "))?.[1] ?? 1) || 1);
      if (!/iCIMS_|icims/i.test(html)) throw new Error("This is not an iCIMS job search page, so nothing was read.");
    }
    let found = 0;
    // One card per posting; the card holds the places and the posted date before the title link.
    for (const card of html.split(/<li[^>]*class="[^"]*iCIMS_JobCardItem[^"]*"/i).slice(1)) {
      const a = /href="https?:\/\/[^"/]+\/jobs\/(\d+)\/[^"]*?\/job[^"]*"[^>]*?(?:title="([^"]*)")?/i.exec(card);
      if (!a) continue;
      const title = text(/<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(card)?.[1] ?? "") || text((a[2] ?? "").replace(/^\s*\d+\s*-\s*/, ""));
      if (!title) continue;
      found++;
      if (rows.has(a[1])) continue;
      // "US-VA-Herndon" reads "Herndon, VA, US"; several places are separated by "|".
      const where = text(/Job Locations?<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i.exec(card)?.[1] ?? "").split("|").map((p) => p.trim()).filter(Boolean)
        .map((p) => { const m = /^([A-Z]{2})-([A-Za-z]{2,3})-(.+)$/.exec(p); return m ? `${m[3].trim()}, ${m[2]}, ${m[1]}` : p; });
      const job = base(a[1], `https://${host}/jobs/${a[1]}/job`, title, company, where.join("; "));
      const posted = /Posted Date<\/span>\s*<span[^>]*title="(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(card);
      if (posted) job.postedAt = iso(`${posted[3]}-${posted[1].padStart(2, "0")}-${posted[2].padStart(2, "0")}`);
      rows.set(a[1], { id: a[1], fromList: job });
    }
    if (!found) break;
  }
  return incremental([...rows.values()], known, started, pages > ICIMS_MAX_PAGES, pageDetail(slug, company, "?in_iframe=1"));
}

// ---------------------------------------------------------------- Oracle Recruiting

// The REST resources an Oracle career site reads itself. A board is "<host without .oraclecloud.com>.<site>",
// for example "jpmc.fa.cx_1001".
const ORACLE_BOARD = /^((?:[a-z0-9-]+\.)+fa(?:\.[a-z0-9]+)?)\.([a-z0-9_-]{1,60})$/;
const ORACLE_CAP = 5000;

function oracleBoard(slug: string) {
  const m = ORACLE_BOARD.exec(slug.trim().toLowerCase());
  if (!m) throw new Error(`"${slug}" is not an Oracle Recruiting board.`);
  const host = `${m[1]}.oraclecloud.com`;
  return { host, site: m[2], api: `https://${host}/hcmRestApi/resources/latest` };
}

function oracleDetail(slug: string): Detail {
  const { api, site } = oracleBoard(slug);
  return async (row) => {
    const url = `${api}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${encodeURIComponent(row.id)}%22,siteNumber=${site}`;
    const d = obj(arr(obj(await getJson(url)).items)[0]);
    if (!Object.keys(d).length) return null;
    const html = [str(d.ExternalDescriptionStr), str(d.ExternalResponsibilitiesStr) && `<h3>Responsibilities</h3>${str(d.ExternalResponsibilitiesStr)}`, str(d.ExternalQualificationsStr) && `<h3>Qualifications</h3>${str(d.ExternalQualificationsStr)}`].filter(Boolean).join("");
    const type = `${str(d.JobSchedule)} ${str(d.WorkerType) || str(d.JobType)}`.toLowerCase();
    return {
      ...row.fromList,
      title: text(d.Title) || row.fromList.title,
      descriptionHtml: html || str(d.ShortDescriptionStr),
      postedAt: iso(str(d.ExternalPostedStartDate)) ?? row.fromList.postedAt,
      employmentType: /intern/.test(type) ? "Internship" : /part/.test(type) ? "Part-time" : /contract|contingent|temporary/.test(type) ? "Contract" : /full/.test(type) ? "Full-time" : null,
      department: text(d.JobFunction) || text(d.Organization) || row.fromList.department,
    };
  };
}

async function oracle(slug: string, company: string, known: Set<string>): Promise<Listing> {
  const { host, site, api } = oracleBoard(slug);
  const started = Date.now();
  const rows = new Map<string, Row>();
  let total = -1;
  for (let offset = 0; offset < ORACLE_CAP; offset += 200) {
    const url = `${api}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},limit=200,offset=${offset},sortBy=POSTING_DATES_DESC`;
    const first = obj(arr(obj(await getJson(url)).items)[0]);
    if (!Array.isArray(first.requisitionList)) throw new Error("The Oracle answer has no job list; the career site may have changed, or the site name is wrong, so nothing was read.");
    if (offset === 0) total = num(first.TotalJobsCount) ?? -1;
    let fresh = 0;
    for (const r of first.requisitionList.map(obj)) {
      const id = str(r.Id) || (typeof r.Id === "number" ? String(r.Id) : "");
      const title = text(r.Title);
      if (!id || !title || rows.has(id)) continue;
      const where = distinct([text(r.PrimaryLocation), ...arr(r.secondaryLocations).map((s) => text(obj(s).Name))]).join("; ");
      const job = base(id, `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${encodeURIComponent(id)}`, title, company, where);
      const mode = str(r.WorkplaceTypeCode).toUpperCase();
      job.workModel = mode.includes("REMOTE") ? "remote" : mode.includes("HYBRID") ? "hybrid" : /ON_?SITE/.test(mode) ? "onsite" : null;
      job.countryCode = str(r.PrimaryLocationCountry) || null;
      job.postedAt = iso(str(r.PostedDate));
      job.department = text(r.JobFunction) || text(r.JobFamily);
      rows.set(id, { id, fromList: job });
      fresh++;
    }
    if (first.requisitionList.length < 200 || fresh === 0 || (total >= 0 && rows.size >= total)) break;
  }
  return incremental([...rows.values()], known, started, total >= 0 && rows.size < total, oracleDetail(slug));
}

// ---------------------------------------------------------------- JazzHR

// Career pages at https://<company>.applytojob.com/apply: one list page with every open posting, and job pages that
// carry a schema.org JobPosting.
async function jazzhr(slug: string, company: string, known: Set<string>): Promise<Listing> {
  const host = `${subdomain("JazzHR", slug)}.applytojob.com`;
  const started = Date.now();
  const html = await getText(`https://${host}/apply`);
  const rows = new Map<string, Row>();
  const link = /<a[^>]+href="(?:https?:\/\/[^"/]+)?\/apply\/([A-Za-z0-9]{6,20})\/([^"?#]*)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = link.exec(html); m; m = link.exec(html)) {
    const title = text(m[3]);
    if (!title || rows.has(m[1])) continue;
    // The place follows the link inside the same list item.
    const after = html.slice(link.lastIndex, link.lastIndex + 600).split(/<a[^>]+href="[^"]*\/apply\//i)[0];
    rows.set(m[1], { id: m[1], fromList: base(m[1], `https://${host}/apply/${m[1]}/${m[2]}`, title, company, text(/fa-map-marker[^>]*>\s*<\/i>([^<]*)/i.exec(after)?.[1] ?? "")) });
  }
  if (!rows.size && !/applytojob|jazz/i.test(html)) throw new Error("This is not a JazzHR careers page, so nothing was read.");
  return incremental([...rows.values()], known, started, false, pageDetail(slug, company));
}

// ---------------------------------------------------------------- BambooHR

// Career pages at https://<company>.bamboohr.com/careers: the JSON the careers page itself loads.
const bambooWhere = (r: Record<string, unknown>) => { const l = obj(r.location); const a = obj(r.atsLocation); return place(l.city ?? a.city, l.state ?? a.state ?? a.province, l.addressCountry ?? a.country); };
// BambooHR's locationType: "0" on site, "1" remote, "2" hybrid.
const bambooMode = (r: Record<string, unknown>): WorkModel | null => { const t = String(r.locationType ?? ""); return t === "1" || r.isRemote === true ? "remote" : t === "2" ? "hybrid" : t === "0" ? "onsite" : null; };

function bamboohrDetail(slug: string): Detail {
  const host = `${subdomain("BambooHR", slug)}.bamboohr.com`;
  return async (row) => {
    const j = obj(obj(obj(await getJson(`https://${host}/careers/${encodeURIComponent(row.id)}/detail`)).result).jobOpening);
    if (!Object.keys(j).length) return null;
    const pay = text(j.compensation);
    return {
      ...row.fromList,
      title: text(j.jobOpeningName) || row.fromList.title,
      location: bambooWhere(j) || row.fromList.location,
      descriptionHtml: `${str(j.description)}${pay ? `<p>Compensation: ${pay}</p>` : ""}`,
      postedAt: iso(str(j.datePosted)),
      employmentType: str(j.employmentStatusLabel) || row.fromList.employmentType,
      department: text(j.departmentLabel) || row.fromList.department,
      workModel: bambooMode(j) ?? row.fromList.workModel,
    };
  };
}

async function bamboohr(slug: string, company: string, known: Set<string>): Promise<Listing> {
  const host = `${subdomain("BambooHR", slug)}.bamboohr.com`;
  const started = Date.now();
  const body = obj(await getJson(`https://${host}/careers/list`));
  if (!Array.isArray(body.result)) throw new Error("The BambooHR answer has no job list; the careers page may have changed, so nothing was read.");
  const rows: Row[] = [];
  for (const r of body.result.map(obj)) {
    const id = str(r.id) || (typeof r.id === "number" ? String(r.id) : "");
    const title = text(r.jobOpeningName);
    if (!id || !title) continue;
    const job = base(id, `https://${host}/careers/${encodeURIComponent(id)}`, title, company, bambooWhere(r));
    job.workModel = bambooMode(r);
    job.employmentType = str(r.employmentStatusLabel) || null;
    job.department = text(r.departmentLabel);
    rows.push({ id, fromList: job });
  }
  return incremental(rows, known, started, false, bamboohrDetail(slug));
}

// ---------------------------------------------------------------- Amazon

// amazon.jobs: the search its own results page reads, 100 postings a request with their full text. One search stops
// at 10,000 results and the United States has more, so the site is read one job category at a time.
const AMAZON = "https://www.amazon.jobs";
const AMAZON_CAP = 10_000;

const heading = (title: string, html: string) => (html ? `<h3>${title}</h3>${html}` : "");
/** A date a site gives in words or without a time zone can land a few hours ahead: never later than now. */
const notAfterNow = (d: string | null) => (d && Date.parse(d) > Date.now() ? new Date().toISOString() : d);

async function amazon(company: string, known: Set<string>): Promise<Listing> {
  const started = Date.now();
  const search = (query: string, offset: number, size: number) => getJson(`${AMAZON}/en/search.json?offset=${offset}&result_limit=${size}&sort=recent&normalized_country_code[]=USA${query}`);
  const first = obj(await search("&facets[]=category", 0, 1));
  const facets = arr(obj(first.facets).category_facet).flatMap((f) => Object.entries(obj(f))).filter(([, n]) => typeof n === "number" && n > 0);
  if (!Array.isArray(first.jobs) || !facets.length) throw new Error("The Amazon answer has no job list; the careers site may have changed, so nothing was read.");
  const out: Listing = { jobs: [], seenIds: [], partial: false };
  const seen = new Set<string>();
  for (const [category] of facets) {
    // "Operations, IT, & Support Engineering" is asked for as "operations-it-support-engineering".
    // A few ("PR") answer only to the name as it is written.
    let key = category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    for (let offset = 0; offset < AMAZON_CAP; offset += 100) {
      if (Date.now() - started > SITE_LIMITS.ms) { out.partial = true; break; }
      let body = obj(await search(`&category[]=${encodeURIComponent(key)}`, offset, 100));
      if (offset === 0 && !arr(body.jobs).length && key !== category) { key = category; body = obj(await search(`&category[]=${encodeURIComponent(key)}`, offset, 100)); }
      const jobs = arr(body.jobs).map(obj);
      // A category the search does not know by either name, or one past the limit: the list is not whole.
      if ((offset === 0 && !jobs.length) || (num(body.hits) ?? 0) >= AMAZON_CAP) out.partial = true;
      for (const j of jobs) {
        const id = str(j.id_icims);
        const title = text(j.title);
        if (!id || !title || !str(j.job_path) || seen.has(id)) continue;
        seen.add(id);
        if (known.has(id)) { out.seenIds.push(id); continue; }
        const job = base(id, `${AMAZON}${str(j.job_path)}`, title, company, str(j.normalized_location) || str(j.location));
        job.applyUrl = str(j.url_next_step);
        job.descriptionHtml = `${str(j.description)}${heading("Basic qualifications", str(j.basic_qualifications))}${heading("Preferred qualifications", str(j.preferred_qualifications))}`;
        job.employmentType = j.is_intern === true ? "Internship" : /part/i.test(str(j.job_schedule_type)) ? "Part-time" : /full/i.test(str(j.job_schedule_type)) ? "Full-time" : null;
        job.department = text(j.job_category);
        job.postedAt = notAfterNow(iso(str(j.posted_date).replace(/\s+/g, " ")));
        job.countryCode = "US";
        out.jobs.push(job);
      }
      if (jobs.length < 100 || offset + 100 >= (num(body.hits) ?? 0)) break;
    }
    if (Date.now() - started > SITE_LIMITS.ms) break;
  }
  return out;
}

// ---------------------------------------------------------------- Microsoft

// apply.careers.microsoft.com: the search its own careers page reads (ten postings a request, newest first) and the
// details of one position. United States postings.
const MICROSOFT = "https://apply.careers.microsoft.com";

const microsoftDetail: Detail = async (row) => {
  const d = obj(obj(await getJson(`${MICROSOFT}/api/pcsx/position_details?position_id=${row.id}&domain=microsoft.com&hl=en`)).data);
  if (!str(d.jobDescription)) return null;
  const type = arr(d.efcustomTextEmploymentType).map(str).join(" ").toLowerCase();
  return {
    ...row.fromList,
    title: text(d.name) || row.fromList.title,
    descriptionHtml: str(d.jobDescription),
    employmentType: /intern/.test(type) ? "Internship" : /part/.test(type) ? "Part-time" : /contract|temporary/.test(type) ? "Contract" : /full/.test(type) ? "Full-time" : null,
  };
};

async function microsoft(company: string, known: Set<string>): Promise<Listing> {
  const started = Date.now();
  const rows = new Map<string, Row>();
  let total = -1;
  let outOfTime = false;
  for (let start = 0; total < 0 || start < total; start += 10) {
    if (Date.now() - started > SITE_LIMITS.ms / 2) { outOfTime = true; break; }
    let data: Record<string, unknown>;
    try {
      data = obj(obj(await getJson(`${MICROSOFT}/api/pcsx/search?domain=microsoft.com&query=&location=United%20States&start=${start}&sort_by=timestamp`)).data);
    } catch (e) {
      // The site turns requests away now and then ("too many requests"). Past the first page, keep what was listed.
      if (!rows.size) throw e;
      outOfTime = true;
      break;
    }
    if (!Array.isArray(data.positions)) throw new Error("The Microsoft answer has no job list; the careers site may have changed, so nothing was read.");
    if (start === 0) total = num(data.count) ?? 0;
    for (const p of data.positions.map(obj)) {
      const id = typeof p.id === "number" ? String(p.id) : str(p.id);
      const title = text(p.name);
      if (!/^\d+$/.test(id) || !title || rows.has(id)) continue;
      const job = base(id, `${MICROSOFT}/careers/job/${id}`, title, company, distinct([...arr(p.standardizedLocations), ...(arr(p.standardizedLocations).length ? [] : arr(p.locations))].map(text)).join("; "));
      const mode = str(p.workLocationOption).toLowerCase();
      job.workModel = mode === "remote" ? "remote" : mode === "hybrid" ? "hybrid" : mode === "onsite" ? "onsite" : null;
      job.department = text(p.department);
      job.postedAt = num(p.postedTs) ? iso((num(p.postedTs) as number) * 1000) : null;
      job.countryCode = "US";
      rows.set(id, { id, fromList: job });
    }
    if (!data.positions.length) break;
  }
  return incremental([...rows.values()], known, started, outOfTime || rows.size < total, microsoftDetail, SITE_LIMITS);
}

// ---------------------------------------------------------------- Apple

// jobs.apple.com: the search pages (twenty postings each) and the job pages. Both carry their data as JSON inside
// the page, the same data the page draws itself from. United States postings.
const APPLE = "https://jobs.apple.com/en-us";

function appleData(html: string): Record<string, unknown> {
  const m = /__staticRouterHydrationData\s*=\s*JSON\.parse\("((?:[^"\\]|\\.)*)"\)/.exec(html);
  if (!m) return {};
  try { return obj(obj(JSON.parse(JSON.parse(`"${m[1]}"`) as string)).loaderData); } catch { return {}; }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Plain text with line breaks, the way Apple holds a posting, as paragraphs. */
const paragraphs = (v: unknown) => str(v).split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${escapeHtml(l)}</p>`).join("");
const applePlaces = (v: unknown) => distinct(arr(v).map(obj).map((l) => place(l.name || l.city, l.stateProvince, /united states/i.test(str(l.countryName)) ? "US" : l.countryName))).join("; ");

const appleDetail: Detail = async (row) => {
  const d = obj(obj(appleData(await getText(row.fromList.url)).jobDetails).jobsData);
  const html = `${paragraphs(d.jobSummary)}${heading("Description", paragraphs(d.description))}${heading("Responsibilities", paragraphs(d.responsibilities))}${heading("Minimum qualifications", paragraphs(d.minimumQualifications))}${heading("Preferred qualifications", paragraphs(d.preferredQualifications))}`;
  if (!html) return null;
  return {
    ...row.fromList,
    title: text(d.postingTitle) || row.fromList.title,
    location: applePlaces(d.locations) || row.fromList.location,
    descriptionHtml: html,
    workModel: d.homeOffice === true ? "remote" : row.fromList.workModel,
    employmentType: /intern/i.test(`${str(d.employmentType)} ${str(d.postingTitle)}`) ? "Internship" : null,
  };
};

async function apple(company: string, known: Set<string>): Promise<Listing> {
  const started = Date.now();
  const rows = new Map<string, Row>();
  let total = -1;
  let outOfTime = false;
  for (let page = 1; total < 0 || (page - 1) * 20 < total; page++) {
    if (Date.now() - started > SITE_LIMITS.ms / 2) { outOfTime = true; break; }
    const search = obj(appleData(await getText(`${APPLE}/search?location=united-states-USA&page=${page}`)).search);
    if (!Array.isArray(search.searchResults)) throw new Error("The Apple page has no job list; the careers site may have changed, so nothing was read.");
    if (page === 1) total = num(search.totalRecords) ?? 0;
    for (const r of search.searchResults.map(obj)) {
      const id = str(r.id);
      const title = text(r.postingTitle);
      if (!/^[\w-]+$/.test(id) || !title || rows.has(id)) continue;
      const job = base(id, `${APPLE}/details/${id}/${encodeURIComponent(str(r.transformedPostingTitle))}`, title, company, applePlaces(r.locations));
      job.department = text(obj(r.team).teamName);
      job.postedAt = notAfterNow(iso(str(r.postDateInGMT)));
      job.countryCode = "US";
      if (r.homeOffice === true) job.workModel = "remote";
      rows.set(id, { id, fromList: job });
    }
    if (!search.searchResults.length) break;
  }
  return incremental([...rows.values()], known, started, outOfTime || rows.size < total, appleDetail, SITE_LIMITS);
}

// ---------------------------------------------------------------- Meta

// metacareers.com: its job sitemap names every open posting, and each job page carries a schema.org JobPosting. The
// sitemap gives no titles, so a posting enters the feed once its page has been read; the newest are read first.
const META = "https://www.metacareers.com";

async function meta(company: string, known: Set<string>): Promise<Listing> {
  const started = Date.now();
  const xml = await getText(`${META}/jobsearch/sitemap.xml`);
  const rows: Array<Row & { changed: string }> = [];
  for (const m of xml.matchAll(/<loc>\s*https:\/\/www\.metacareers\.com\/profile\/job_details\/(\d+)\/?\s*<\/loc>(?:\s*<lastmod>([^<]*)<\/lastmod>)?/g)) {
    rows.push({ id: m[1], changed: m[2] ?? "", fromList: base(m[1], `${META}/profile/job_details/${m[1]}/`, "", company, "") });
  }
  if (!rows.length) throw new Error("Meta's job sitemap lists no postings; the careers site may have changed, so nothing was read.");
  rows.sort((a, b) => (iso(b.changed) ?? "").localeCompare(iso(a.changed) ?? ""));
  return incremental(rows, known, started, false, async (row) => {
    const ld = jobPostingOf(await getText(row.fromList.url));
    if (!ld) return null;
    const job = withJobPosting(row.fromList, ld, false);
    // Meta runs each list together as one line, its items parted by a non-breaking space.
    const items = (v: unknown) => { const xs = str(v).split(/&nbsp;| /).map((x) => x.trim()).filter(Boolean); return xs.length ? `<ul>${xs.map((x) => `<li>${x}</li>`).join("")}</ul>` : ""; };
    job.descriptionHtml = `<p>${job.descriptionHtml}</p>${heading("Responsibilities", items(ld.responsibilities))}${heading("Qualifications", items(ld.qualifications))}`;
    return job;
  }, SITE_LIMITS);
}

export function fetchOther(ats: Ats, slug: string, company: string, known: Set<string>): Promise<Listing> {
  switch (ats) {
    case "amazon": return amazon(company, known);
    case "microsoft": return microsoft(company, known);
    case "apple": return apple(company, known);
    case "meta": return meta(company, known);
    case "workday": return workday(slug, company, known);
    case "workable": return workable(slug, company);
    case "icims": return icims(slug, company, known);
    case "oracle": return oracle(slug, company, known);
    case "jazzhr": return jazzhr(slug, company, known);
    case "bamboohr": return bamboohr(slug, company, known);
    default: throw new Error(`Jobhunt has no reader for ${ats}.`);
  }
}

/**
 * Reads one posting in full, for a job that was saved from its board's list alone. `fromList` is what is held about
 * it. Null when the provider has no page per posting to read, or the page no longer shows the posting.
 */
export async function fetchPosting(ats: Ats, slug: string, company: string, fromList: RawJob): Promise<RawJob | null> {
  const detail: Detail | null =
    ats === "workday" ? workdayDetail(slug, company) : ats === "icims" ? pageDetail(slug, company, "?in_iframe=1") : ats === "jazzhr" ? pageDetail(slug, company)
    : ats === "oracle" ? oracleDetail(slug) : ats === "bamboohr" ? bamboohrDetail(slug) : ats === "microsoft" ? microsoftDetail : ats === "apple" ? appleDetail : null;
  if (!detail) return null;
  const job = await detail({ id: fromList.externalId, fromList });
  return job && job.descriptionHtml ? job : null;
}
