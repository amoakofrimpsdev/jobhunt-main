// The local database: one SQLite file in .data/. Nothing in the app needs a server, an account or a key.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { EMPTY_PROFILE, type Ats, type Board, type Collection, type JobCard, type JobDetail, type Match, type Profile, type TrackStatus } from "./types";
import { skillName } from "./taxonomy";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY,
  ats TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_ok INTEGER,
  last_error TEXT,
  UNIQUE (ats, slug)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  ats TEXT NOT NULL,
  url TEXT NOT NULL,
  apply_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'unknown',
  work_model TEXT,
  employment_type TEXT,
  department TEXT NOT NULL DEFAULT '',
  family TEXT,
  level TEXT,
  years_min INTEGER,
  pay_min REAL,
  pay_max REAL,
  pay_currency TEXT,
  pay_period TEXT,
  posted_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  closed_at TEXT,
  description_html TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '[]',
  sponsorship TEXT,
  e_verify INTEGER,
  blocker TEXT,
  blocker_text TEXT,
  evidence TEXT NOT NULL DEFAULT '{}',
  h1b_filings INTEGER NOT NULL DEFAULT 0,
  cap_exempt INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jobs_board ON jobs (board_id, closed_at);
CREATE INDEX IF NOT EXISTS jobs_open ON jobs (closed_at, posted_at);
-- Everything the feed, its counts and the scorer read, in one index. A job's row also holds its whole posting, so
-- reading tens of thousands of rows means reading hundreds of megabytes from disk; with this the rows are never
-- touched until one job is opened.
CREATE INDEX IF NOT EXISTS jobs_light ON jobs (closed_at, board_id, id, company, title, location, department, country,
  posted_at, first_seen_at, blocker, work_model, level, years_min, family, h1b_filings, e_verify, cap_exempt, pay_min, skills);
CREATE TABLE IF NOT EXISTS matches (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS applications (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  not_read TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS board_collections (
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY (board_id, collection_id)
);
CREATE INDEX IF NOT EXISTS board_collections_by_collection ON board_collections (collection_id);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  resume_name TEXT,
  warnings TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_job ON documents (job_id, created_at);
CREATE TABLE IF NOT EXISTS answers (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  site TEXT NOT NULL DEFAULT '',
  uses INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  mtime INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',
  titles TEXT NOT NULL DEFAULT '[]',
  years INTEGER,
  added_at TEXT NOT NULL
);
`;

// The boards a refresh reads and the feed shows: switched on, and either added directly or in a collection that is
// switched on. Created after the `direct` column exists (older databases get it in db()).
const ACTIVE_VIEW = `
CREATE VIEW IF NOT EXISTS active_boards AS
  SELECT b.id FROM boards b WHERE b.enabled = 1 AND (b.direct = 1 OR EXISTS (
    SELECT 1 FROM board_collections bc JOIN collections c ON c.id = bc.collection_id
    WHERE bc.board_id = b.id AND c.enabled = 1));
`;

// Boards read on a fresh install: large, well-known employers that hire in the United States across many kinds of
// work. Sources lists the rest of the directory.
const STARTER: Array<[Ats, string, string]> = [
  ["greenhouse", "stripe", "Stripe"], ["greenhouse", "airbnb", "Airbnb"], ["greenhouse", "databricks", "Databricks"],
  ["greenhouse", "figma", "Figma"], ["greenhouse", "anthropic", "Anthropic"], ["greenhouse", "cloudflare", "Cloudflare"],
  ["greenhouse", "coinbase", "Coinbase"], ["greenhouse", "datadog", "Datadog"], ["greenhouse", "discord", "Discord"],
  ["greenhouse", "dropbox", "Dropbox"], ["greenhouse", "gusto", "Gusto"], ["greenhouse", "instacart", "Instacart"],
  ["greenhouse", "pinterest", "Pinterest"], ["greenhouse", "robinhood", "Robinhood"], ["greenhouse", "asana", "Asana"],
  ["greenhouse", "affirm", "Affirm"], ["greenhouse", "brex", "Brex"], ["greenhouse", "chime", "Chime"],
  ["greenhouse", "duolingo", "Duolingo"], ["greenhouse", "okta", "Okta"], ["greenhouse", "carta", "Carta"],
  ["greenhouse", "airtable", "Airtable"], ["greenhouse", "coursera", "Coursera"], ["greenhouse", "flexport", "Flexport"],
  ["greenhouse", "faire", "Faire"], ["greenhouse", "andurilindustries", "Anduril Industries"],
  ["greenhouse", "chanzuckerberginitiative", "Chan Zuckerberg Initiative"], ["greenhouse", "codeforamerica", "Code for America"],
  ["greenhouse", "lyft", "Lyft"], ["greenhouse", "reddit", "Reddit"], ["greenhouse", "mongodb", "MongoDB"],
  ["greenhouse", "twilio", "Twilio"], ["greenhouse", "samsara", "Samsara"], ["greenhouse", "scaleai", "Scale AI"],
  ["greenhouse", "roblox", "Roblox"], ["greenhouse", "toast", "Toast"], ["greenhouse", "verkada", "Verkada"],
  ["greenhouse", "waymo", "Waymo"],
  ["lever", "palantir", "Palantir"], ["lever", "mistral", "Mistral AI"],
  ["lever", "spotify", "Spotify"], ["lever", "zoox", "Zoox"], ["lever", "veeva", "Veeva Systems"],
  ["ashby", "vanta", "Vanta"], ["ashby", "perplexity", "Perplexity"], ["ashby", "openai", "OpenAI"],
  ["ashby", "ramp", "Ramp"], ["ashby", "notion", "Notion"], ["ashby", "linear", "Linear"], ["ashby", "deel", "Deel"],
  ["ashby", "cursor", "Cursor"], ["ashby", "replit", "Replit"], ["ashby", "harvey", "Harvey"],
  ["ashby", "elevenlabs", "ElevenLabs"], ["ashby", "benchling", "Benchling"], ["ashby", "sierra", "Sierra"],
  ["ashby", "cohere", "Cohere"],
];

// SQLite ships inside Node (22.5 and later). It is asked for at run time because the bundler cannot load it.
const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

type Row = Record<string, unknown>;
// Bumped with every change to the tables, so a development server that keeps the database open across code reloads
// brings it up to date instead of running new code against the old tables.
const SCHEMA_VERSION = 5;
const g = globalThis as unknown as { __jobhuntDb?: DatabaseSync; __jobhuntSchema?: number };

/** The folder that holds the database and the resume files added to the app. */
export function dataDir(): string {
  return process.env.JOBHUNT_DATA_DIR ?? join(process.cwd(), ".data");
}

export function db(): DatabaseSync {
  if (g.__jobhuntDb && g.__jobhuntSchema === SCHEMA_VERSION) return g.__jobhuntDb;
  let d = g.__jobhuntDb;
  if (!d) {
    const dir = dataDir();
    mkdirSync(dir, { recursive: true });
    d = new sqlite.DatabaseSync(join(dir, "jobhunt.db"));
    d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_size_limit = 33554432; PRAGMA cache_size = -65536;");
  }
  d.exec(SCHEMA);
  const columns = (d.prepare("PRAGMA table_info(boards)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!columns.includes("direct")) d.exec("ALTER TABLE boards ADD COLUMN direct INTEGER NOT NULL DEFAULT 1");
  d.exec(ACTIVE_VIEW);
  const count = d.prepare("SELECT COUNT(*) AS n FROM boards").get() as { n: number };
  if (count.n === 0) {
    const insert = d.prepare("INSERT OR IGNORE INTO boards (ats, slug, name, enabled) VALUES (?, ?, ?, 1)");
    for (const [ats, slug, name] of STARTER) insert.run(ats, slug, name);
  }
  g.__jobhuntDb = d;
  g.__jobhuntSchema = SCHEMA_VERSION;
  seedCollections(d);
  return d;
}

export function transaction<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

// ---------------------------------------------------------------- directory and boards

export type DirectoryBoard = { ats: Ats; slug: string; name: string; verified: boolean };
let dir: DirectoryBoard[] | null = null;

/** Employer boards known to answer, shipped with the app (data/boards.json). */
export function directory(): DirectoryBoard[] {
  dir ??= (JSON.parse(readFileSync(join(process.cwd(), "data", "boards.json"), "utf8")) as { boards: DirectoryBoard[] }).boards;
  return dir;
}

type CollectionsFile = {
  collections: Array<{ id: string; name: string; url: string; notRead: Record<string, number> }>;
  boards: Array<{ ats: Ats; slug: string; name: string; in: string[] }>;
};

/**
 * Follows each collection that ships with the app (data/collections.json), once. A collection the person removed, or
 * a board they removed from one, is not brought back by the next launch.
 */
function seedCollections(d: DatabaseSync): void {
  let file: CollectionsFile;
  try {
    file = JSON.parse(readFileSync(join(process.cwd(), "data", "collections.json"), "utf8")) as CollectionsFile;
  } catch {
    return;
  }
  const seeded = new Set(getMeta<string[]>("collectionsSeeded", []));
  const fresh = file.collections.filter((c) => !seeded.has(c.id));
  if (!fresh.length) return;
  const wanted = new Set(fresh.map((c) => c.id));
  transaction(() => {
    const addCollection = d.prepare("INSERT OR IGNORE INTO collections (id, name, url, enabled, not_read) VALUES (?, ?, ?, 1, ?)");
    for (const c of fresh) addCollection.run(c.id, c.name, c.url, JSON.stringify(c.notRead ?? {}));
    const addBoard = d.prepare("INSERT OR IGNORE INTO boards (ats, slug, name, enabled, direct) VALUES (?, ?, ?, 1, 0)");
    const idOf = d.prepare("SELECT id FROM boards WHERE ats = ? AND slug = ? COLLATE NOCASE");
    const link = d.prepare("INSERT OR IGNORE INTO board_collections (board_id, collection_id) VALUES (?, ?)");
    for (const b of file.boards) {
      const mine = b.in.filter((id) => wanted.has(id));
      if (!mine.length) continue;
      let row = idOf.get(b.ats, b.slug) as { id: number } | undefined;
      if (!row) { addBoard.run(b.ats, b.slug, b.name); row = idOf.get(b.ats, b.slug) as { id: number }; }
      for (const id of mine) link.run(row.id, id);
    }
  });
  setMeta("collectionsSeeded", [...seeded, ...wanted]);
}

export function listCollections(): Collection[] {
  const rows = db().prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM board_collections bc WHERE bc.collection_id = c.id) AS boards,
      (SELECT COUNT(*) FROM jobs j JOIN board_collections bc ON bc.board_id = j.board_id
        WHERE bc.collection_id = c.id AND j.closed_at IS NULL) AS open_jobs
    FROM collections c ORDER BY c.name COLLATE NOCASE`).all() as Row[];
  return rows.map((r) => ({
    id: r.id as string, name: r.name as string, url: r.url as string, enabled: r.enabled === 1,
    boards: r.boards as number, openJobs: r.open_jobs as number, notRead: JSON.parse(r.not_read as string) as Record<string, number>,
  }));
}

/** Switched off, a collection's boards are no longer read and their jobs leave the feed; nothing is deleted. */
export function setCollectionEnabled(id: string, enabled: boolean): void {
  db().prepare("UPDATE collections SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function listBoards(): Board[] {
  const rows = db().prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM jobs j WHERE j.board_id = b.id AND j.closed_at IS NULL) AS open_jobs,
      b.id IN (SELECT id FROM active_boards) AS active
    FROM boards b ORDER BY b.name COLLATE NOCASE`).all() as Row[];
  return rows.map((r) => ({
    id: r.id as number, ats: r.ats as Ats, slug: r.slug as string, name: r.name as string, enabled: r.enabled === 1,
    lastRunAt: r.last_run_at as string | null, lastOk: r.last_ok === null ? null : r.last_ok === 1,
    lastError: r.last_error as string | null, openJobs: r.open_jobs as number, direct: r.direct === 1, active: r.active === 1,
  }));
}

export function addBoard(ats: Ats, slug: string, name: string): number {
  db().prepare("INSERT INTO boards (ats, slug, name, enabled, direct) VALUES (?, ?, ?, 1, 1) ON CONFLICT (ats, slug) DO UPDATE SET enabled = 1, direct = 1").run(ats, slug, name);
  return (db().prepare("SELECT id FROM boards WHERE ats = ? AND slug = ?").get(ats, slug) as { id: number }).id;
}

/** Removes a board and its postings. Postings in the tracker are kept (closed), so the board row stays, switched off. */
/** The stand-in board that holds jobs saved from a page in the browser. It is never read on a refresh. */
export function manualBoard(): Pick<Board, "id" | "ats" | "slug"> {
  const d = db();
  d.prepare("INSERT OR IGNORE INTO boards (ats, slug, name, enabled, direct) VALUES ('manual', 'browser', 'Saved from the browser', 1, 1)").run();
  const row = d.prepare("SELECT id FROM boards WHERE ats = 'manual' AND slug = 'browser'").get() as { id: number };
  return { id: row.id, ats: "manual", slug: "browser" };
}

export function removeBoard(id: number): void {
  const d = db();
  d.prepare("DELETE FROM jobs WHERE board_id = ? AND id NOT IN (SELECT job_id FROM applications) AND id NOT IN (SELECT job_id FROM documents)").run(id);
  const left = d.prepare("SELECT COUNT(*) AS n FROM jobs WHERE board_id = ?").get(id) as { n: number };
  if (left.n === 0) { d.prepare("DELETE FROM boards WHERE id = ?").run(id); return; }
  d.prepare("UPDATE jobs SET closed_at = COALESCE(closed_at, ?) WHERE board_id = ?").run(new Date().toISOString(), id);
  d.prepare("UPDATE boards SET enabled = 0 WHERE id = ?").run(id);
}

export function recordBoardRun(id: number, ok: boolean, error: string | null, name?: string): void {
  db().prepare("UPDATE boards SET last_run_at = ?, last_ok = ?, last_error = ?, name = COALESCE(?, name) WHERE id = ?")
    .run(new Date().toISOString(), ok ? 1 : 0, error, name ?? null, id);
}

// ---------------------------------------------------------------- meta and profile

export function getMeta<T>(key: string, fallback: T): T {
  const row = db().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setMeta(key: string, value: unknown): void {
  db().prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}

export function getProfile(): Profile {
  return { ...EMPTY_PROFILE, ...getMeta<Partial<Profile>>("profile", {}) };
}

export function saveProfile(p: Profile): Profile {
  const saved = { ...p, updatedAt: new Date().toISOString() };
  setMeta("profile", saved);
  return saved;
}

/** A profile that has enough in it to rank jobs. */
export function profileReady(p: Profile): boolean {
  return p.targetTitles.length > 0 || p.skills.length > 0;
}

// ---------------------------------------------------------------- jobs

export type JobRow = {
  id: string; boardId: number; ats: Ats; url: string; applyUrl: string; title: string; company: string; location: string;
  country: string; workModel: string | null; employmentType: string | null; department: string; family: string | null;
  level: string | null; yearsMin: number | null; payMin: number | null; payMax: number | null; payCurrency: string | null;
  payPeriod: string | null; postedAt: string | null; descriptionHtml: string; skills: string[]; sponsorship: string | null;
  eVerify: boolean | null; blocker: string | null; blockerText: string | null; evidence: Record<string, string>;
  h1bFilings: number; capExempt: boolean;
};

/**
 * Writes one board's whole listing. A posting that was there before and is not in this listing is closed; a posting
 * that comes back is reopened. Call only with a listing that was read in full.
 */
export function saveBoardListing(boardId: number, jobs: JobRow[], closeMissing = true): { added: number; closed: number } {
  const d = db();
  const now = new Date().toISOString();
  const known = new Set((d.prepare("SELECT id FROM jobs WHERE board_id = ?").all(boardId) as Array<{ id: string }>).map((r) => r.id));
  const upsert = d.prepare(`
    INSERT INTO jobs (id, board_id, ats, url, apply_url, title, company, location, country, work_model, employment_type,
      department, family, level, years_min, pay_min, pay_max, pay_currency, pay_period, posted_at, first_seen_at,
      last_seen_at, closed_at, description_html, skills, sponsorship, e_verify, blocker, blocker_text, evidence,
      h1b_filings, cap_exempt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET url = excluded.url, apply_url = excluded.apply_url, title = excluded.title,
      company = excluded.company, location = excluded.location, country = excluded.country,
      work_model = excluded.work_model, employment_type = excluded.employment_type, department = excluded.department,
      family = excluded.family, level = excluded.level, years_min = excluded.years_min, pay_min = excluded.pay_min,
      pay_max = excluded.pay_max, pay_currency = excluded.pay_currency, pay_period = excluded.pay_period,
      posted_at = excluded.posted_at, last_seen_at = excluded.last_seen_at, closed_at = NULL,
      description_html = excluded.description_html, skills = excluded.skills, sponsorship = excluded.sponsorship,
      e_verify = excluded.e_verify, blocker = excluded.blocker, blocker_text = excluded.blocker_text,
      evidence = excluded.evidence, h1b_filings = excluded.h1b_filings, cap_exempt = excluded.cap_exempt`);
  return transaction(() => {
    let added = 0;
    const seen = new Set<string>();
    for (const j of jobs) {
      if (seen.has(j.id)) continue;
      seen.add(j.id);
      if (!known.has(j.id)) added++;
      upsert.run(j.id, boardId, j.ats, j.url, j.applyUrl, j.title, j.company, j.location, j.country, j.workModel,
        j.employmentType, j.department, j.family, j.level, j.yearsMin, j.payMin, j.payMax, j.payCurrency, j.payPeriod,
        j.postedAt, now, now, j.descriptionHtml, JSON.stringify(j.skills), j.sponsorship,
        j.eVerify === null ? null : j.eVerify ? 1 : 0, j.blocker, j.blockerText, JSON.stringify(j.evidence),
        j.h1bFilings, j.capExempt ? 1 : 0);
    }
    const close = d.prepare("UPDATE jobs SET closed_at = ? WHERE id = ? AND closed_at IS NULL");
    let closed = 0;
    if (closeMissing) for (const id of known) if (!seen.has(id)) closed += Number(close.run(now, id).changes);
    return { added, closed };
  });
}

/** What the scorer needs from every open posting. */
export function jobsForScoring(): Array<Pick<JobRow, "id" | "title" | "family" | "level" | "yearsMin" | "skills" | "blocker" | "workModel" | "location">> {
  const rows = db().prepare("SELECT id, title, family, level, years_min, skills, blocker, work_model, location FROM jobs WHERE closed_at IS NULL AND board_id IN (SELECT id FROM active_boards)").all() as Row[];
  return rows.map((r) => ({
    id: r.id as string, title: r.title as string, family: r.family as string | null, level: r.level as string | null,
    yearsMin: r.years_min as number | null, skills: JSON.parse(r.skills as string) as string[],
    blocker: r.blocker as string | null, workModel: r.work_model as string | null, location: r.location as string,
  }));
}

export function saveMatches(matches: Array<{ jobId: string; match: Match }>): void {
  const d = db();
  transaction(() => {
    d.exec("DELETE FROM matches");
    const insert = d.prepare("INSERT INTO matches (job_id, score, detail) VALUES (?, ?, ?)");
    for (const m of matches) insert.run(m.jobId, m.match.score, JSON.stringify(m.match));
  });
}

const CARD_COLUMNS = `j.id, j.title, j.company, j.location, j.country, j.work_model, j.employment_type, j.level, j.years_min,
  j.pay_min, j.pay_max, j.pay_currency, j.pay_period, j.posted_at, j.first_seen_at, j.url, j.ats, j.sponsorship, j.e_verify,
  j.blocker, j.h1b_filings, j.cap_exempt, j.closed_at, m.detail AS match_detail, a.status AS status`;

function card(r: Row): JobCard {
  return {
    id: r.id as string, title: r.title as string, company: r.company as string, location: r.location as string,
    country: r.country as JobCard["country"], workModel: r.work_model as JobCard["workModel"],
    employmentType: r.employment_type as string | null, level: r.level as JobCard["level"],
    yearsMin: r.years_min as number | null, payMin: r.pay_min as number | null, payMax: r.pay_max as number | null,
    payCurrency: r.pay_currency as string | null, payPeriod: r.pay_period as JobCard["payPeriod"],
    postedAt: r.posted_at as string | null, firstSeenAt: r.first_seen_at as string, url: r.url as string,
    ats: r.ats as Ats, sponsorship: r.sponsorship as JobCard["sponsorship"],
    eVerify: r.e_verify === null ? null : r.e_verify === 1, blocker: r.blocker as JobCard["blocker"],
    h1bFilings: r.h1b_filings as number, capExempt: r.cap_exempt === 1, closedAt: r.closed_at as string | null,
    match: r.match_detail ? (JSON.parse(r.match_detail as string) as Match) : null,
    status: (r.status as TrackStatus | null) ?? null,
  };
}

export type FeedFilter = {
  q?: string;
  workModels?: string[];
  levels?: string[];
  postedWithinDays?: number;
  usOnly?: boolean;
  hideBlocked?: boolean;
  h1bOnly?: boolean;
  eVerifyOnly?: boolean;
  capExemptOnly?: boolean;
  payListed?: boolean;
  minScore?: number;
  sort?: "recommended" | "newest" | "score";
  limit?: number;
  offset?: number;
};

export type Feed = { total: number; jobs: JobCard[]; openJobs: number; newToday: number; strong: number; blocked: number; employers: number };

const DAY = 86_400_000;

export function feed(f: FeedFilter): Feed {
  const where = ["j.closed_at IS NULL", "j.board_id IN (SELECT id FROM active_boards)", "(a.status IS NULL OR a.status = 'saved')"];
  const args: Array<string | number> = [];
  for (const word of (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
    where.push("(lower(j.title) LIKE ? OR lower(j.company) LIKE ? OR lower(j.location) LIKE ? OR lower(j.department) LIKE ?)");
    const like = `%${word.replace(/[%_]/g, "")}%`;
    args.push(like, like, like, like);
  }
  const inList = (column: string, values: string[] | undefined) => {
    if (!values?.length) return;
    where.push(`${column} IN (${values.map(() => "?").join(",")})`);
    args.push(...values);
  };
  inList("j.work_model", f.workModels);
  inList("j.level", f.levels);
  if (f.postedWithinDays) {
    where.push("COALESCE(j.posted_at, j.first_seen_at) >= ?");
    args.push(new Date(Date.now() - f.postedWithinDays * DAY).toISOString());
  }
  // A bare "Remote" names no country, so it stays in.
  if (f.usOnly) where.push("j.country != 'other'");
  if (f.hideBlocked) where.push("j.blocker IS NULL");
  if (f.h1bOnly) where.push("j.h1b_filings > 0 AND j.blocker IS NULL");
  if (f.eVerifyOnly) where.push("j.e_verify = 1");
  if (f.capExemptOnly) where.push("j.cap_exempt = 1");
  if (f.payListed) where.push("j.pay_min IS NOT NULL");
  if (f.minScore) { where.push("m.score >= ?"); args.push(f.minScore); }

  const d = db();
  // Every match is ranked on four small columns; the full cards are read only for the page that is shown.
  type Light = { id: string; company: string; at: number; score: number | null };
  const jobs = (d.prepare(`SELECT j.id, j.company, COALESCE(j.posted_at, j.first_seen_at) AS at, m.score FROM jobs j
    LEFT JOIN matches m ON m.job_id = j.id LEFT JOIN applications a ON a.job_id = j.id
    WHERE ${where.join(" AND ")}`).all(...args) as Row[])
    .map((r): Light => ({ id: r.id as string, company: r.company as string, at: Date.parse(r.at as string), score: r.score as number | null }));
  const now = Date.now();
  const sort = f.sort ?? "recommended";
  const scored = jobs.some((j) => j.score !== null);
  const tie = (a: Light, b: Light) => b.at - a.at || a.id.localeCompare(b.id);
  if (sort === "newest" || !scored) {
    jobs.sort(tie);
  } else if (sort === "score") {
    jobs.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || tie(a, b));
  } else {
    // Recommended: the score, a little extra for fresh postings, and less for each further posting from an employer
    // that is already on the page, so one company with twenty openings does not take the whole top of the feed.
    const base = (j: Light) => (j.score ?? 0) + (now - j.at < 3 * DAY ? 3 : now - j.at < 7 * DAY ? 1 : 0);
    jobs.sort((a, b) => base(b) - base(a) || tie(a, b));
    const seen = new Map<string, number>();
    const rank = new Map<string, number>();
    for (const j of jobs) {
      const n = seen.get(j.company) ?? 0;
      seen.set(j.company, n + 1);
      rank.set(j.id, base(j) - 4 * Math.min(n, 6));
    }
    jobs.sort((a, b) => rank.get(b.id)! - rank.get(a.id)! || tie(a, b));
  }
  const offset = f.offset ?? 0;
  const pageIds = jobs.slice(offset, offset + (f.limit ?? 40)).map((j) => j.id);
  const cards = new Map<string, JobCard>();
  if (pageIds.length) {
    const rows = d.prepare(`SELECT ${CARD_COLUMNS} FROM jobs j LEFT JOIN matches m ON m.job_id = j.id
      LEFT JOIN applications a ON a.job_id = j.id WHERE j.id IN (${pageIds.map(() => "?").join(",")})`).all(...pageIds) as Row[];
    for (const r of rows) cards.set(r.id as string, card(r));
  }
  const stats = d.prepare(`SELECT COUNT(*) AS open,
      SUM(CASE WHEN COALESCE(j.posted_at, j.first_seen_at) >= ? THEN 1 ELSE 0 END) AS fresh,
      SUM(CASE WHEN m.score >= 80 THEN 1 ELSE 0 END) AS strong,
      SUM(CASE WHEN j.blocker IS NOT NULL THEN 1 ELSE 0 END) AS blocked,
      COUNT(DISTINCT j.board_id) AS employers
    FROM jobs j LEFT JOIN matches m ON m.job_id = j.id
    WHERE j.closed_at IS NULL AND j.board_id IN (SELECT id FROM active_boards)`).get(new Date(now - DAY).toISOString()) as Row;
  return {
    total: jobs.length, jobs: pageIds.map((id) => cards.get(id)).filter((j): j is JobCard => j !== undefined),
    openJobs: (stats.open as number) ?? 0, newToday: (stats.fresh as number) ?? 0, strong: (stats.strong as number) ?? 0,
    blocked: (stats.blocked as number) ?? 0, employers: (stats.employers as number) ?? 0,
  };
}

/** One posting's scoring facts, for scoring it against something other than the saved profile. */
export function jobScoringFacts(id: string): Pick<JobRow, "title" | "family" | "level" | "yearsMin" | "skills" | "blocker"> | null {
  const r = db().prepare("SELECT title, family, level, years_min, skills, blocker FROM jobs WHERE id = ?").get(id) as Row | undefined;
  return r ? {
    title: r.title as string, family: r.family as string | null, level: r.level as string | null,
    yearsMin: r.years_min as number | null, skills: JSON.parse(r.skills as string) as string[], blocker: r.blocker as string | null,
  } : null;
}

export function jobDetail(id: string): Omit<JobDetail, "resumes"> | null {
  const r = db().prepare(`SELECT ${CARD_COLUMNS}, j.apply_url, j.department, j.description_html, j.blocker_text, j.evidence,
      j.skills, a.notes AS notes FROM jobs j LEFT JOIN matches m ON m.job_id = j.id
    LEFT JOIN applications a ON a.job_id = j.id WHERE j.id = ?`).get(id) as Row | undefined;
  if (!r) return null;
  const have = new Set(getProfile().skills);
  return {
    ...card(r), applyUrl: (r.apply_url as string) || (r.url as string), department: r.department as string,
    descriptionHtml: r.description_html as string, blockerText: r.blocker_text as string | null,
    evidence: JSON.parse(r.evidence as string) as Record<string, string>,
    skills: (JSON.parse(r.skills as string) as string[]).map((s) => ({ id: s, name: skillName(s), have: have.has(s) })),
    notes: (r.notes as string | null) ?? "",
  };
}

// ---------------------------------------------------------------- tracker

/** False when the job is not in the database. */
export function track(jobId: string, status: TrackStatus | null, notes?: string): boolean {
  const d = db();
  if (!d.prepare("SELECT 1 FROM jobs WHERE id = ?").get(jobId)) return false;
  if (status === null) { d.prepare("DELETE FROM applications WHERE job_id = ?").run(jobId); return true; }
  const now = new Date().toISOString();
  d.prepare(`INSERT INTO applications (job_id, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (job_id) DO UPDATE SET status = excluded.status, notes = COALESCE(?, notes), updated_at = excluded.updated_at`)
    .run(jobId, status, notes ?? "", now, now, notes ?? null);
  return true;
}

export type Tracked = JobCard & { notes: string; updatedAt: string };

export function tracked(): Tracked[] {
  const rows = db().prepare(`SELECT ${CARD_COLUMNS}, a.notes AS notes, a.updated_at AS updated_at FROM applications a
    JOIN jobs j ON j.id = a.job_id LEFT JOIN matches m ON m.job_id = j.id ORDER BY a.updated_at DESC`).all() as Row[];
  return rows.map((r) => ({ ...card(r), notes: r.notes as string, updatedAt: r.updated_at as string }));
}
