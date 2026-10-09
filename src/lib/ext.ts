// The browser extension's side of the app. The extension is given nothing until it presents the pairing code shown
// in Settings: a long random value that lives in the local database and can be replaced at any time, which cuts off
// every copy of the extension that held the old one.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { listAnswers, saveAnswer, seedAnswers } from "./answers";
import { startRefresh, toJobRow } from "./ingest";
import { rescore } from "./ingest";
import { listResumes, resumeFits } from "./resumes";
import { detectBoard } from "./sources";
import { addBoard, db, directory, getMeta, jobDetail, jobScoringFacts, manualBoard, saveBoardListing, setMeta, track } from "./store";

export function extToken(): string {
  let token = getMeta<string | null>("extToken", null);
  if (!token) { token = randomBytes(24).toString("base64url"); setMeta("extToken", token); }
  return token;
}

export function newExtToken(): string {
  setMeta("extToken", randomBytes(24).toString("base64url"));
  return extToken();
}

export function extTokenOk(given: string | null): boolean {
  const mine = extToken();
  return !!given && given.length === mine.length && timingSafeEqual(Buffer.from(given), Buffer.from(mine));
}

/** The job in the database that a page in the browser is showing, or null. */
export function jobIdForUrl(input: string): string | null {
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  const d = db();
  const like = (pattern: string) => (d.prepare("SELECT id FROM jobs WHERE id LIKE ? ORDER BY closed_at IS NOT NULL LIMIT 1").get(pattern) as { id: string } | undefined)?.id ?? null;
  const parts = u.pathname.split("/").filter(Boolean);
  const host = u.host.toLowerCase();
  const safe = (s: string | undefined | null) => (s && /^[\w.-]+$/.test(s) ? s : null);
  if (host.endsWith("greenhouse.io")) {
    const i = parts.indexOf("jobs");
    const id = safe(i >= 0 ? parts[i + 1] : null) ?? safe(u.searchParams.get("gh_jid")) ?? safe(u.searchParams.get("token"));
    if (id) return like(`greenhouse:%:${id}`);
  }
  // A company's own careers page that shows a Greenhouse job names it in the address.
  const ghJid = safe(u.searchParams.get("gh_jid"));
  if (ghJid) return like(`greenhouse:%:${ghJid}`);
  if (host === "jobs.lever.co" && safe(parts[1])) return like(`lever:%:${parts[1]}`);
  if (host === "jobs.ashbyhq.com" && safe(parts[1])) return like(`ashby:%:${parts[1]}`);
  // The other providers put the posting's own id in the address.
  const tail = (re: RegExp) => safe(re.exec(u.pathname)?.[1]);
  if (/\.myworkday(?:jobs|site)\.com$/.test(host) && parts.includes("job") && safe(parts[parts.length - 1])) return like(`workday:%:${parts[parts.length - 1]}`);
  if (host.endsWith(".icims.com") && tail(/\/jobs\/(\d+)\//)) return like(`icims:%:${tail(/\/jobs\/(\d+)\//)}`);
  if (host.endsWith(".applytojob.com") && tail(/\/apply\/([A-Za-z0-9]{6,20})/)) return like(`jazzhr:%:${tail(/\/apply\/([A-Za-z0-9]{6,20})/)}`);
  if (host.endsWith(".bamboohr.com") && tail(/\/careers\/(\d+)/)) return like(`bamboohr:%:${tail(/\/careers\/(\d+)/)}`);
  if (host === "apply.workable.com" && tail(/\/j\/([A-Za-z0-9]+)/)) return like(`workable:%:${tail(/\/j\/([A-Za-z0-9]+)/)}`);
  if (host.endsWith(".oraclecloud.com") && tail(/\/job\/(\d+)/)) return like(`oracle:%:${tail(/\/job\/(\d+)/)}`);
  const plain = `${u.origin}${u.pathname}`.replace(/\/(?:apply|application)\/?$/, "").replace(/\/$/, "");
  const row = d.prepare("SELECT id FROM jobs WHERE url = ? OR url = ? OR apply_url = ? LIMIT 1").get(plain, `${plain}/`, input) as { id: string } | undefined;
  return row?.id ?? null;
}

/** What the extension needs on an application page: the job, which resume to send, and the answers to fill in. */
export function pageContext(url: string) {
  seedAnswers();
  const jobId = jobIdForUrl(url);
  const job = jobId ? jobDetail(jobId) : null;
  const facts = jobId ? jobScoringFacts(jobId) : null;
  const fits = facts ? resumeFits(facts, job?.match?.score ?? null) : [];
  const resumes = fits.length
    ? fits.map((f) => ({ id: f.id, name: f.name, score: f.score as number | null }))
    : listResumes().map((r) => ({ id: r.id, name: r.name, score: null as number | null }));
  return {
    job: job ? { id: job.id, title: job.title, company: job.company, score: job.match?.score ?? null, band: job.match?.band ?? null, status: job.status, blocker: job.blocker } : null,
    canFollowBoard: !job && detectBoard(url) !== null,
    resumes,
    answers: listAnswers().map((a) => ({ key: a.key, label: a.label, value: a.value, kind: a.kind })),
    recordDemographics: getMeta<boolean>("extRecordDemographics", false),
  };
}

const MIME: Record<string, string> = { ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain", ".md": "text/markdown" };

/** A resume file from the library, for the extension to attach to a form. */
export function resumeFile(id: string): { name: string; mime: string; base64: string } | null {
  const row = db().prepare("SELECT name, path FROM resumes WHERE id = ?").get(id) as { name: string; path: string } | undefined;
  if (!row) return null;
  try {
    return { name: row.name, mime: MIME[extname(row.name).toLowerCase()] ?? "application/octet-stream", base64: readFileSync(row.path).toString("base64") };
  } catch {
    return null;
  }
}

export function recordAnswers(items: Array<{ key?: unknown; label?: unknown; value?: unknown; kind?: unknown }>, site: string): number {
  let saved = 0;
  for (const it of items.slice(0, 200)) {
    if (typeof it.key !== "string" || typeof it.label !== "string" || typeof it.value !== "string" || !it.value.trim()) continue;
    saveAnswer({ key: it.key, label: it.label, value: it.value, kind: typeof it.kind === "string" ? it.kind : "text", site });
    saved++;
  }
  return saved;
}

export function noteUsed(keys: string[]): void {
  const stmt = db().prepare("UPDATE answers SET uses = uses + 1 WHERE key = ?");
  for (const k of keys.slice(0, 200)) stmt.run(k);
}

/**
 * Saves the job a page shows. On a Greenhouse, Lever or Ashby page the employer's whole board is followed and read,
 * so the job arrives with the rest; anywhere else the page's own title and text are kept as a single saved job.
 */
export function saveJobFromPage(p: { url: string; title: string; company: string; location: string; text: string }): { jobId: string | null; followed: string | null } {
  const found = detectBoard(p.url);
  if (found) {
    const known = directory().find((b) => b.ats === found.ats && b.slug.toLowerCase() === found.slug.toLowerCase());
    const id = addBoard(found.ats, known?.slug ?? found.slug, known?.name ?? (p.company || found.slug));
    startRefresh([id]);
    return { jobId: jobIdForUrl(p.url), followed: known?.name ?? (p.company || found.slug) };
  }
  if (!p.title.trim()) throw new Error("This page does not look like a job posting: it has no title to save.");
  const u = new URL(p.url);
  const board = manualBoard();
  const externalId = `${u.host}${u.pathname}${u.search}`.replace(/[^\w.-]+/g, "_").slice(0, 180);
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = p.text.slice(0, 60_000).split(/\n{2,}/).map((para) => `<p>${escape(para).replace(/\n/g, "<br>")}</p>`).join("");
  const row = toJobRow(board, {
    externalId, url: p.url, applyUrl: p.url, title: p.title.trim().slice(0, 200), company: (p.company.trim() || u.host.replace(/^www\./, "")).slice(0, 120),
    location: p.location.trim().slice(0, 200), descriptionHtml: html, workModel: null, employmentType: null, department: "",
    postedAt: null, countryCode: null, pay: null,
  });
  saveBoardListing(board.id, [row], false);
  track(row.id, "saved");
  rescore();
  return { jobId: row.id, followed: null };
}
