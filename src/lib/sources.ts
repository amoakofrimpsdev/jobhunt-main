// Readers for the three job boards that publish a documented public feed: Greenhouse, Lever and Ashby. One request
// returns an employer's whole board, straight from the employer, so a posting that is gone from the reply is closed.
import type { Ats, PayPeriod, RawJob, WorkModel } from "./types";

const USER_AGENT = "jobhunt/0.2 (personal job search; no personal data)";
const nextSlot = new Map<string, number>();

/** GET JSON, at most one request a second per host. */
async function getJson(url: string): Promise<unknown> {
  const host = new URL(url).host;
  const at = Math.max(Date.now(), nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + 1000);
  if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(45_000), cache: "no-store" });
  if (res.status === 404) throw new Error("The board was not found (404). The employer may have moved to another provider.");
  if (!res.ok) throw new Error(`The board answered ${res.status}.`);
  return res.json();
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function iso(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function workplace(v: string): WorkModel | null {
  const k = v.toLowerCase().replace(/[^a-z]/g, "");
  return k === "remote" ? "remote" : k === "hybrid" ? "hybrid" : k === "onsite" ? "onsite" : null;
}

function pay(min: number | null, max: number | null, currency: string, period: PayPeriod | null): RawJob["pay"] {
  if (!period || (min === null && max === null)) return null;
  return { min: min ?? max, max: max ?? min, currency: currency || "USD", period };
}

const distinct = (xs: string[]) => [...new Map(xs.filter(Boolean).map((x) => [x.toLowerCase(), x])).values()];

const GENERIC_PLACE = /^(?:hybrid|remote|in[- ]office|on-?site|distributed|n\/?a|multiple\s+locations|various(?:\s+locations)?|)$/i;

async function greenhouse(slug: string, company: string): Promise<RawJob[]> {
  const body = obj(await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`));
  if (!Array.isArray(body.jobs)) throw new Error("The reply has no job list.");
  return arr(body.jobs).map(obj).filter((j) => j.id !== undefined && j.id !== null).map((j) => {
    const departments = arr(j.departments).map((d) => str(obj(d).name)).filter(Boolean);
    // Some boards put the work model in the location field ("Hybrid", "In-Office") and the places in the offices.
    let location = str(obj(j.location).name);
    const generic = GENERIC_PLACE.test(location);
    if (generic) {
      const offices = distinct(arr(j.offices).map((o) => str(obj(o).location) || str(obj(o).name)).filter((o) => !GENERIC_PLACE.test(o)));
      if (offices.length) location = offices.slice(0, 6).join("; ");
    }
    return {
      externalId: String(j.id),
      url: str(j.absolute_url),
      applyUrl: "",
      title: str(j.title),
      company: company || str(j.company_name),
      location,
      descriptionHtml: str(j.content),
      workModel: generic ? workplace(str(obj(j.location).name).replace(/in[- ]office/i, "onsite")) : null,
      employmentType: null,
      department: departments[0] ?? "",
      // `updated_at` moves on every edit, so only `first_published` is a posting date.
      postedAt: iso(j.first_published),
      countryCode: null,
      pay: null,
    };
  });
}

async function lever(slug: string, company: string): Promise<RawJob[]> {
  const body = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
  if (!Array.isArray(body)) throw new Error("The reply is not a list of postings.");
  return body.map(obj).filter((p) => str(p.id)).map((p) => {
    const cats = obj(p.categories);
    // Lever splits the body across description, lists (a heading and HTML items) and additional.
    let html = str(p.description);
    for (const l of arr(p.lists).map(obj)) html += `<h3>${str(l.text)}</h3><ul>${str(l.content)}</ul>`;
    html += str(p.additional);
    const sr = obj(p.salaryRange);
    const interval = str(sr.interval);
    const period: PayPeriod | null = interval === "per-year-salary" ? "year" : interval === "per-month-salary" ? "month" : interval === "per-hour-wage" ? "hour" : null;
    return {
      externalId: str(p.id),
      url: str(p.hostedUrl),
      applyUrl: str(p.applyUrl),
      title: str(p.text),
      company,
      location: distinct([str(cats.location), ...arr(cats.allLocations).map(str)]).join("; "),
      descriptionHtml: html,
      workModel: workplace(str(p.workplaceType)),
      employmentType: str(cats.commitment) || null,
      department: str(cats.department) || str(cats.team),
      postedAt: iso(num(p.createdAt)),
      countryCode: str(p.country) || null,
      pay: pay(num(sr.min), num(sr.max), str(sr.currency), period),
    };
  });
}

function ashbyPay(compensation: unknown): RawJob["pay"] {
  // The board's overall range (summaryComponents), not the first tier of several.
  const comp = obj(compensation);
  const period = (i: string): PayPeriod | null => (i === "1 YEAR" ? "year" : i === "1 MONTH" ? "month" : i === "1 HOUR" ? "hour" : null);
  const salary = (list: unknown[]) => list.map(obj).filter((c) => str(c.compensationType) === "Salary" && period(str(c.interval)) && (num(c.minValue) !== null || num(c.maxValue) !== null));
  let comps = salary(arr(comp.summaryComponents));
  if (!comps.length) comps = salary(arr(comp.compensationTiers).flatMap((t) => arr(obj(t).components)));
  if (!comps.length) return null;
  const first = comps[0];
  const same = comps.filter((c) => str(c.interval) === str(first.interval) && str(c.currencyCode) === str(first.currencyCode));
  const mins = same.map((c) => num(c.minValue)).filter((v): v is number => v !== null && v > 0);
  const maxs = same.map((c) => num(c.maxValue)).filter((v): v is number => v !== null && v > 0);
  return pay(mins.length ? Math.min(...mins) : null, maxs.length ? Math.max(...maxs) : null, str(first.currencyCode), period(str(first.interval)));
}

async function ashby(slug: string, company: string): Promise<RawJob[]> {
  // Without includeCompensation=true the API silently drops the pay.
  const body = obj(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`));
  if (!Array.isArray(body.jobs)) throw new Error("The reply has no job list.");
  return arr(body.jobs).map(obj).filter((j) => str(j.id) && j.isListed !== false).map((j) => {
    const type = str(j.employmentType);
    return {
      externalId: str(j.id),
      url: str(j.jobUrl),
      applyUrl: str(j.applyUrl),
      title: str(j.title),
      company,
      location: distinct([str(j.location), ...arr(j.secondaryLocations).map((s) => str(obj(s).location))]).join("; "),
      descriptionHtml: str(j.descriptionHtml) || str(j.descriptionPlain),
      workModel: workplace(str(j.workplaceType)) ?? (j.isRemote === true ? "remote" : null),
      employmentType: type === "FullTime" ? "Full-time" : type === "PartTime" ? "Part-time" : type === "Intern" ? "Internship" : type === "Contract" || type === "Temporary" ? "Contract" : null,
      department: str(j.department) || str(j.team),
      postedAt: iso(j.publishedAt),
      countryCode: str(obj(obj(j.address).postalAddress).addressCountry) || null,
      pay: ashbyPay(j.compensation),
    };
  });
}

export function fetchBoard(ats: Ats, slug: string, company: string): Promise<RawJob[]> {
  if (ats === "greenhouse") return greenhouse(slug, company);
  if (ats === "lever") return lever(slug, company);
  if (ats === "ashby") return ashby(slug, company);
  throw new Error("Jobs saved from the browser have no board to read.");
}

/** The board a careers link points at ("https://jobs.lever.co/acme/123" -> lever, acme), or null. */
export function detectBoard(input: string): { ats: Exclude<Ats, "manual">; slug: string } | null {
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`); } catch { return null; }
  const host = url.host.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  const ok = (s: string | undefined) => (s && /^[A-Za-z0-9._-]+$/.test(s) ? s : null);
  if (host.endsWith("greenhouse.io")) {
    const forParam = ok(url.searchParams.get("for") ?? undefined);
    const slug = forParam ?? ok(parts[0] === "embed" || parts[0] === "v1" ? parts[2] : parts[0]);
    return slug ? { ats: "greenhouse", slug } : null;
  }
  if (host === "jobs.lever.co" || host === "api.lever.co") {
    const slug = ok(host === "api.lever.co" ? parts[2] : parts[0]);
    return slug ? { ats: "lever", slug } : null;
  }
  if (host === "jobs.ashbyhq.com" || host === "api.ashbyhq.com") {
    const slug = ok(host === "api.ashbyhq.com" ? parts[2] : parts[0]);
    return slug ? { ats: "ashby", slug } : null;
  }
  return null;
}
