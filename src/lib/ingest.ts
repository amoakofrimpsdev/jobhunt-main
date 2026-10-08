// Reading boards into the store: fetch, parse each posting's facts once, save, then score everything.
import { capExemptLikely, h1bFilings } from "./company";
import { scoreJob, scorerFor } from "./match";
import { countryOf, employmentTypeOf, levelOfTitle, levelOfYears, payFromText, workModelOf, yearsRequired } from "./parse/facts";
import { parseStatements, visaBlocker } from "./parse/statements";
import { fetchBoard } from "./sources";
import { getMeta, getProfile, jobsForScoring, listBoards, profileReady, recordBoardRun, saveBoardListing, saveMatches, setMeta, type JobRow } from "./store";
import { familyOfTitle, scanSkills } from "./taxonomy";
import { htmlToText, sanitizeHtml } from "./text";
import type { Board, Match, RawJob } from "./types";

export function toJobRow(board: Pick<Board, "id" | "ats" | "slug">, raw: RawJob): JobRow {
  const text = htmlToText(raw.descriptionHtml);
  const family = familyOfTitle(raw.title)?.family ?? null;
  const statements = parseStatements(text);
  const blocker = visaBlocker(raw.title, text, statements);
  const years = yearsRequired(text);
  const pay = raw.pay ?? payFromText(text);
  const evidence: Record<string, string> = { ...statements.evidence };
  if (years) evidence.years = years.evidence;
  return {
    id: `${board.ats}:${board.slug}:${raw.externalId}`,
    boardId: board.id,
    ats: board.ats,
    url: raw.url,
    applyUrl: raw.applyUrl,
    title: raw.title,
    company: raw.company,
    location: raw.location,
    country: countryOf(raw.location, raw.countryCode),
    workModel: workModelOf(raw.workModel, raw.location, text),
    employmentType: employmentTypeOf(raw.employmentType, raw.title),
    department: raw.department,
    family,
    level: levelOfTitle(raw.title) ?? (years ? levelOfYears(years.min) : null),
    yearsMin: years?.min ?? null,
    payMin: pay?.min ?? null,
    payMax: pay?.max ?? null,
    payCurrency: pay?.currency ?? null,
    payPeriod: pay?.period ?? null,
    postedAt: raw.postedAt,
    descriptionHtml: sanitizeHtml(raw.descriptionHtml),
    skills: scanSkills(`${raw.title}\n${text}`, family).slice(0, 20),
    sponsorship: statements.sponsorship,
    eVerify: statements.eVerify,
    blocker: blocker?.reason ?? null,
    blockerText: blocker?.text ?? null,
    evidence,
    h1bFilings: h1bFilings(raw.company),
    capExempt: capExemptLikely(raw.company),
  };
}

/** Scores every open posting against the saved profile. With no usable profile the feed is simply unscored. */
export function rescore(): number {
  const profile = getProfile();
  if (!profileReady(profile)) { saveMatches([]); return 0; }
  const scorer = scorerFor(profile);
  const out: Array<{ jobId: string; match: Match }> = [];
  for (const j of jobsForScoring()) {
    const match = scoreJob(scorer, j);
    if (match) out.push({ jobId: j.id, match });
  }
  saveMatches(out);
  return out.length;
}

export type RefreshStatus = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  done: number;
  total: number;
  added: number;
  closed: number;
  failed: number;
  current: string | null;
  /** When every enabled board was last read in one run. */
  lastFullAt: string | null;
};

const IDLE: RefreshStatus = { running: false, startedAt: null, finishedAt: null, done: 0, total: 0, added: 0, closed: 0, failed: 0, current: null, lastFullAt: null };
const g = globalThis as unknown as { __jobhuntRefresh?: RefreshStatus };

export function refreshStatus(): RefreshStatus {
  // A run lives in this process: one the database remembers as running after a restart is over.
  const status = g.__jobhuntRefresh ?? { ...getMeta<RefreshStatus>("refresh", IDLE), running: false };
  return { ...status, lastFullAt: getMeta<string | null>("lastFullRefresh", null) };
}

/** Starts reading the given boards (default: every enabled board) and returns at once; refreshStatus() follows it. */
export function startRefresh(boardIds?: number[]): RefreshStatus {
  if (g.__jobhuntRefresh?.running) return g.__jobhuntRefresh;
  const boards = listBoards().filter((b) => b.ats !== "manual" && (boardIds ? boardIds.includes(b.id) : b.active));
  const status: RefreshStatus = { ...IDLE, running: true, startedAt: new Date().toISOString(), total: boards.length };
  g.__jobhuntRefresh = status;

  let lastScored = Date.now();
  const readBoard = async (b: Board) => {
    status.current = b.name;
    try {
      const raw = await fetchBoard(b.ats, b.slug, b.name);
      // Reading a posting's facts is plain computing: a pause every few postings lets the screens be answered
      // while a large board is being read.
      const rows: JobRow[] = [];
      for (const j of raw) {
        if (j.title && j.url) rows.push(toJobRow(b, j));
        if (rows.length % 25 === 0) await new Promise((r) => setImmediate(r));
      }
      const result = saveBoardListing(b.id, rows);
      status.added += result.added;
      status.closed += result.closed;
      recordBoardRun(b.id, true, null);
    } catch (e) {
      // A board that fails closes nothing: its postings stay as they were.
      status.failed++;
      recordBoardRun(b.id, false, e instanceof Error ? e.message : String(e));
    }
    status.done++;
    // Scoring everything takes a moment once there are many jobs, so it runs every half minute while boards arrive.
    if (Date.now() - lastScored > 30_000) { rescore(); lastScored = Date.now(); }
  };

  // One board at a time per provider (each is one host, read at one request a second); the providers run side by side.
  const queues = new Map<string, Board[]>();
  for (const b of boards) queues.set(b.ats, [...(queues.get(b.ats) ?? []), b]);
  void Promise.all([...queues.values()].map(async (queue) => { for (const b of queue) await readBoard(b); }))
    .catch(() => undefined)
    .then(() => {
      rescore();
      status.running = false;
      status.current = null;
      status.finishedAt = new Date().toISOString();
      setMeta("refresh", status);
      if (!boardIds) setMeta("lastFullRefresh", status.finishedAt);
    });
  return status;
}
