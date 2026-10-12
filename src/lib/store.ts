// The local database: one SQLite file in .data/. Nothing in the app needs a server, an account or a key.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { COMPANY_SITES, EMPTY_PROFILE, type Ats, type Board, type Collection, type JobCard, type JobDetail, type Match, type Profile, type RawJob, type TrackStatus } from "./types";
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
  -- 1 when the posting turned up on a board Jobhunt was already following: then the day it was first seen is close
  -- to the day it was posted. 0 when it was already there on the board's first read: then that day says nothing.
  seen_new INTEGER NOT NULL DEFAULT 0,
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
CREATE TABLE IF NOT EXISTS matches (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  detail TEXT NOT NULL
);
-- A match row carries the whole breakdown with its reasons. The feed only needs the number, for hundreds of
-- thousands of jobs at a time, so the number is indexed on its own, by job and by score.
CREATE INDEX IF NOT EXISTS matches_by_job ON matches (job_id, score);
CREATE INDEX IF NOT EXISTS matches_by_score ON matches (score, job_id);
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
-- Pages of a collection's own site that have been read, so a weekly check opens only pages that are new.
CREATE TABLE IF NOT EXISTS collection_pages (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  page TEXT NOT NULL,
  board TEXT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, page)
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  filter TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_run_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_hits (
  alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  found_at TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (alert_id, job_id)
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

// Everything the feed, its counts and the scorer read, in one index. A job's row also holds its whole posting, so
// reading tens of thousands of rows means reading hundreds of megabytes from disk; with this the rows are never
// touched until one job is opened. Made after the columns it names exist (older databases get them in db()).
const FEED_INDEX = `
DROP INDEX IF EXISTS jobs_light;
CREATE INDEX IF NOT EXISTS jobs_feed ON jobs (closed_at, board_id, id, company, title, location, department, country,
  posted_at, first_seen_at, seen_new, blocker, work_model, level, years_min, family, h1b_filings, e_verify, cap_exempt, pay_min, skills);
`;

/**
 * When a posting went up, as far as it is known: the board's own date, else the day Jobhunt first saw it if it
 * arrived on a board already being followed. Otherwise unknown (NULL): the day a board was first read is not a date.
 */
const POSTED = "COALESCE(j.posted_at, CASE WHEN j.seen_new = 1 THEN j.first_seen_at END)";

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
const SCHEMA_VERSION = 9;
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
    d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_size_limit = 33554432; PRAGMA cache_size = -65536; PRAGMA synchronous = NORMAL; PRAGMA mmap_size = 2147483648;");
  }
  d.exec(SCHEMA);
  const columns = (d.prepare("PRAGMA table_info(boards)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!columns.includes("direct")) d.exec("ALTER TABLE boards ADD COLUMN direct INTEGER NOT NULL DEFAULT 1");
  const collectionColumns = (d.prepare("PRAGMA table_info(collections)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!collectionColumns.includes("fixed")) d.exec("ALTER TABLE collections ADD COLUMN fixed INTEGER NOT NULL DEFAULT 0; ALTER TABLE collections ADD COLUMN last_checked_at TEXT; ALTER TABLE collections ADD COLUMN last_result TEXT;");
  const jobColumns = (d.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!jobColumns.includes("seen_new")) {
    d.exec("ALTER TABLE jobs ADD COLUMN seen_new INTEGER NOT NULL DEFAULT 0");
    // Jobs already held: one that arrived more than an hour after its board's first read arrived later, as new.
    d.exec(`UPDATE jobs SET seen_new = 1 WHERE first_seen_at >
      (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', MIN(x.first_seen_at), '+1 hour') FROM jobs x WHERE x.board_id = jobs.board_id)`);
  }
  if (!jobColumns.includes("seen_new")) {
    // Workday postings held without a date were all "Posted 30+ Days Ago": thirty days before they were first seen
    // is the latest day they can have gone up.
    d.exec("UPDATE jobs SET posted_at = strftime('%Y-%m-%dT%H:%M:%fZ', first_seen_at, '-30 days') WHERE ats = 'workday' AND posted_at IS NULL");
  }
  d.exec(FEED_INDEX);
  d.exec(ACTIVE_VIEW);
  const count = d.prepare("SELECT COUNT(*) AS n FROM boards").get() as { n: number };
  if (count.n === 0) {
    const insert = d.prepare("INSERT OR IGNORE INTO boards (ats, slug, name, enabled) VALUES (?, ?, ?, 1)");
    for (const [ats, slug, name] of STARTER) insert.run(ats, slug, name);
  }
  // The employers read from their own careers site are added once, to new and existing databases alike; one that
  // is removed afterwards stays removed.
  const sites = d.prepare("SELECT value FROM meta WHERE key = 'companySites'").get() as { value: string } | undefined;
  const had: string[] = sites ? JSON.parse(sites.value) : [];
  const missing = COMPANY_SITES.filter((c) => !had.includes(c.ats));
  if (missing.length) {
    const insert = d.prepare("INSERT OR IGNORE INTO boards (ats, slug, name, enabled, direct) VALUES (?, ?, ?, 1, 1)");
    for (const c of missing) insert.run(c.ats, c.slug, c.name);
    d.prepare("INSERT INTO meta (key, value) VALUES ('companySites', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(JSON.stringify([...had, ...missing.map((c) => c.ats)]));
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
  collections: Array<{ id: string; name: string; url: string; notRead: Record<string, number>; fixed?: boolean }>;
  boards: Array<{ ats: Ats; slug: string; name: string; in: string[] }>;
};

/**
 * Follows the collections that ship with the app (data/collections.json). Each board of each collection is added
 * once: a board the person removed, or a collection they removed, is not brought back by the next launch, while
 * boards that a newer version of the file adds do arrive.
 */
function seedCollections(d: DatabaseSync): void {
  let file: CollectionsFile;
  try {
    file = JSON.parse(readFileSync(join(process.cwd(), "data", "collections.json"), "utf8")) as CollectionsFile;
  } catch {
    return;
  }
  const seeded = new Set(getMeta<string[]>("collectionsSeeded", []));
  const seenBoards = new Set(getMeta<string[]>("collectionBoardsSeen", []));
  const key = (collection: string, b: { ats: string; slug: string }) => `${collection}|${b.ats}:${b.slug.toLowerCase()}`;
  const todo = file.boards.flatMap((b) => b.in.map((c) => ({ b, c }))).filter(({ b, c }) => !seenBoards.has(key(c, b)));
  const fresh = file.collections.filter((c) => !seeded.has(c.id));
  transaction(() => {
    const addCollection = d.prepare("INSERT OR IGNORE INTO collections (id, name, url, enabled, not_read, fixed) VALUES (?, ?, ?, 1, ?, ?)");
    for (const c of fresh) addCollection.run(c.id, c.name, c.url, JSON.stringify(c.notRead ?? {}), c.fixed || !c.url ? 1 : 0);
    // The counts of boards that cannot be read change when the app learns a new provider.
    const refresh = d.prepare("UPDATE collections SET not_read = ?, fixed = ? WHERE id = ?");
    for (const c of file.collections) refresh.run(JSON.stringify(c.notRead ?? {}), c.fixed || !c.url ? 1 : 0, c.id);
    const exists = new Set((d.prepare("SELECT id FROM collections").all() as Array<{ id: string }>).map((r) => r.id));
    const addBoard = d.prepare("INSERT OR IGNORE INTO boards (ats, slug, name, enabled, direct) VALUES (?, ?, ?, 1, 0)");
    const idOf = d.prepare("SELECT id FROM boards WHERE ats = ? AND slug = ? COLLATE NOCASE");
    const link = d.prepare("INSERT OR IGNORE INTO board_collections (board_id, collection_id) VALUES (?, ?)");
    for (const { b, c } of todo) {
      // A collection the person removed stays removed.
      if (!exists.has(c)) continue;
      let row = idOf.get(b.ats, b.slug) as { id: number } | undefined;
      if (!row) { addBoard.run(b.ats, b.slug, b.name); row = idOf.get(b.ats, b.slug) as { id: number }; }
      link.run(row.id, c);
    }
  });
  if (fresh.length) setMeta("collectionsSeeded", [...seeded, ...fresh.map((c) => c.id)]);
  if (todo.length) setMeta("collectionBoardsSeen", [...seenBoards, ...todo.map(({ b, c }) => key(c, b))]);
}

/** Adds a board a collection's own site was found to list. Returns true when the board is new to the collection. */
export function addCollectionBoard(collectionId: string, ats: Ats, slug: string, name: string): boolean {
  const d = db();
  d.prepare("INSERT OR IGNORE INTO boards (ats, slug, name, enabled, direct) VALUES (?, ?, ?, 1, 0)").run(ats, slug, name);
  const row = d.prepare("SELECT id FROM boards WHERE ats = ? AND slug = ? COLLATE NOCASE").get(ats, slug) as { id: number };
  return Number(d.prepare("INSERT OR IGNORE INTO board_collections (board_id, collection_id) VALUES (?, ?)").run(row.id, collectionId).changes) > 0;
}

export function addCollection(id: string, name: string, url: string): void {
  db().prepare("INSERT OR IGNORE INTO collections (id, name, url, enabled, not_read, fixed) VALUES (?, ?, ?, 1, '{}', 0)").run(id, name, url);
}

export function removeCollection(id: string): void {
  const d = db();
  // Boards followed only through this collection go with it, unless a tracked job or a document hangs on them.
  d.prepare(`DELETE FROM boards WHERE direct = 0 AND id IN (SELECT board_id FROM board_collections WHERE collection_id = ?)
    AND id NOT IN (SELECT board_id FROM board_collections WHERE collection_id != ?)
    AND id NOT IN (SELECT board_id FROM jobs WHERE id IN (SELECT job_id FROM applications) OR id IN (SELECT job_id FROM documents))`).run(id, id);
  d.prepare("DELETE FROM collections WHERE id = ?").run(id);
}

export function recordCollectionCheck(id: string, result: string, done: boolean): void {
  db().prepare("UPDATE collections SET last_result = ?, last_checked_at = CASE WHEN ? THEN ? ELSE last_checked_at END WHERE id = ?")
    .run(result, done ? 1 : 0, new Date().toISOString(), id);
}

/** The pages of a collection's site that were already read, with the board each one led to ("" = none). */
export function collectionPages(id: string): Map<string, string> {
  const rows = db().prepare("SELECT page, board FROM collection_pages WHERE collection_id = ?").all(id) as Array<{ page: string; board: string | null }>;
  return new Map(rows.map((r) => [r.page, r.board ?? ""]));
}

export function saveCollectionPage(id: string, page: string, board: string): void {
  db().prepare("INSERT INTO collection_pages (collection_id, page, board, checked_at) VALUES (?, ?, ?, ?) ON CONFLICT (collection_id, page) DO UPDATE SET board = excluded.board, checked_at = excluded.checked_at")
    .run(id, page, board, new Date().toISOString());
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
    fixed: r.fixed === 1, lastCheckedAt: r.last_checked_at as string | null, lastResult: r.last_result as string | null,
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
/** The ids (as the board gives them) of one board's postings whose full text is already held. */
export function heldPostingIds(board: Pick<Board, "id" | "ats" | "slug">): Set<string> {
  const prefix = `${board.ats}:${board.slug}:`;
  const rows = db().prepare("SELECT id FROM jobs WHERE board_id = ? AND description_html != ''").all(board.id) as Array<{ id: string }>;
  return new Set(rows.filter((r) => r.id.startsWith(prefix)).map((r) => r.id.slice(prefix.length)));
}

/** What is held about one posting that has no text yet, and the board it is on: enough to go and read it. */
export function unreadPosting(id: string): { board: Pick<Board, "id" | "ats" | "slug" | "name">; raw: RawJob } | null {
  const r = db().prepare(`SELECT j.url, j.apply_url, j.title, j.company, j.location, j.work_model, j.employment_type, j.department, j.posted_at,
      j.country, b.id AS board_id, b.ats, b.slug, b.name FROM jobs j JOIN boards b ON b.id = j.board_id
    WHERE j.id = ? AND j.description_html = '' AND j.closed_at IS NULL`).get(id) as Row | undefined;
  if (!r) return null;
  const prefix = `${r.ats}:${r.slug}:`;
  if (!id.startsWith(prefix)) return null;
  return {
    board: { id: r.board_id as number, ats: r.ats as Ats, slug: r.slug as string, name: r.name as string },
    raw: {
      externalId: id.slice(prefix.length), url: r.url as string, applyUrl: r.apply_url as string, title: r.title as string,
      company: r.company as string, location: r.location as string, descriptionHtml: "", workModel: r.work_model as RawJob["workModel"],
      employmentType: r.employment_type as string | null, department: r.department as string, postedAt: r.posted_at as string | null,
      countryCode: r.country === "US" ? "US" : null, pay: null,
    },
  };
}

export function saveBoardListing(boardId: number, jobs: JobRow[], closeMissing = true, stillListed: string[] = []): { added: number; closed: number; written: Set<string> } {
  const d = db();
  const now = new Date().toISOString();
  const known = new Set((d.prepare("SELECT id FROM jobs WHERE board_id = ?").all(boardId) as Array<{ id: string }>).map((r) => r.id));
  const upsert = d.prepare(`
    INSERT INTO jobs (id, board_id, ats, url, apply_url, title, company, location, country, work_model, employment_type,
      department, family, level, years_min, pay_min, pay_max, pay_currency, pay_period, posted_at, first_seen_at,
      last_seen_at, closed_at, description_html, skills, sponsorship, e_verify, blocker, blocker_text, evidence,
      h1b_filings, cap_exempt, seen_new)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET url = excluded.url, apply_url = excluded.apply_url, title = excluded.title,
      company = excluded.company, location = excluded.location, country = excluded.country,
      work_model = excluded.work_model, employment_type = excluded.employment_type, department = excluded.department,
      family = excluded.family, level = excluded.level, years_min = excluded.years_min, pay_min = excluded.pay_min,
      pay_max = excluded.pay_max, pay_currency = excluded.pay_currency, pay_period = excluded.pay_period,
      -- Workday dates are worked out from "Posted 3 Days Ago", and "30+ Days Ago" only gives a latest possible day:
      -- the earliest day seen for a posting is the one to keep.
      posted_at = CASE WHEN excluded.ats = 'workday' AND jobs.posted_at IS NOT NULL AND (excluded.posted_at IS NULL OR jobs.posted_at < excluded.posted_at)
        THEN jobs.posted_at ELSE excluded.posted_at END,
      last_seen_at = excluded.last_seen_at, closed_at = NULL,
      description_html = excluded.description_html, skills = excluded.skills, sponsorship = excluded.sponsorship,
      e_verify = excluded.e_verify, blocker = excluded.blocker, blocker_text = excluded.blocker_text,
      evidence = excluded.evidence, h1b_filings = excluded.h1b_filings, cap_exempt = excluded.cap_exempt`);
  const unscore = d.prepare("DELETE FROM matches WHERE job_id = ?");
  // Most postings on a board are the same from one read to the next. One that reads exactly as it is held is only
  // marked as still listed: writing its text again, and scoring it again, is most of the work of a refresh.
  const same = d.prepare(`SELECT 1 FROM jobs WHERE id = ? AND closed_at IS NULL AND title = ? AND company = ? AND location = ? AND url = ?
    AND description_html = ? AND skills = ? AND blocker IS ? AND sponsorship IS ? AND level IS ? AND pay_min IS ? AND posted_at IS ?`);
  const still = d.prepare("UPDATE jobs SET last_seen_at = ? WHERE id = ?");
  return transaction(() => {
    let added = 0;
    const seen = new Set<string>();
    const written = new Set<string>();
    for (const j of jobs) {
      if (seen.has(j.id)) continue;
      seen.add(j.id);
      if (known.has(j.id) && same.get(j.id, j.title, j.company, j.location, j.url, j.descriptionHtml, JSON.stringify(j.skills), j.blocker, j.sponsorship, j.level, j.payMin, j.postedAt)) {
        still.run(now, j.id);
        continue;
      }
      written.add(j.id);
      if (!known.has(j.id)) added++;
      upsert.run(j.id, boardId, j.ats, j.url, j.applyUrl, j.title, j.company, j.location, j.country, j.workModel,
        j.employmentType, j.department, j.family, j.level, j.yearsMin, j.payMin, j.payMax, j.payCurrency, j.payPeriod,
        j.postedAt, now, now, j.descriptionHtml, JSON.stringify(j.skills), j.sponsorship,
        j.eVerify === null ? null : j.eVerify ? 1 : 0, j.blocker, j.blockerText, JSON.stringify(j.evidence),
        j.h1bFilings, j.capExempt ? 1 : 0, known.size > 0 ? 1 : 0);
      // Its facts may have changed (a posting's text can arrive on a later read): it is scored again.
      if (known.has(j.id)) unscore.run(j.id);
    }
    // Postings that are still on the board but were not read again: they stay open, and one that had closed reopens.
    const touch = d.prepare("UPDATE jobs SET last_seen_at = ?, closed_at = NULL WHERE id = ?");
    for (const id of stillListed) { if (!seen.has(id)) { seen.add(id); touch.run(now, id); } }
    const close = d.prepare("UPDATE jobs SET closed_at = ? WHERE id = ? AND closed_at IS NULL");
    let closed = 0;
    if (closeMissing) for (const id of known) if (!seen.has(id)) closed += Number(close.run(now, id).changes);
    return { added, closed, written };
  });
}

/** What the scorer needs from every open posting. */
type ScoringRow = Pick<JobRow, "id" | "title" | "family" | "level" | "yearsMin" | "skills" | "blocker" | "workModel" | "location">;

/** What the scorer needs from every open posting, or only from those that have no score yet. */
/**
 * Open postings to score, a page at a time in board and id order: `after` is the last row of the page before. Read
 * in pages so that scoring every job (a third of a million of them) never holds the app up for long.
 */
export function jobsForScoring(onlyUnscored = false, after: { boardId: number; id: string } | null = null, limit = 1_000_000): Array<ScoringRow & { boardId: number }> {
  const rows = db().prepare(`SELECT id, board_id, title, family, level, years_min, skills, blocker, work_model, location FROM jobs INDEXED BY jobs_feed
    WHERE closed_at IS NULL AND (board_id, id) > (?, ?) AND board_id IN (SELECT id FROM active_boards)${onlyUnscored ? " AND id NOT IN (SELECT job_id FROM matches)" : ""}
    ORDER BY board_id, id LIMIT ?`).all(after?.boardId ?? -1, after?.id ?? "", limit) as Row[];
  return rows.map((r) => ({
    id: r.id as string, boardId: r.board_id as number, title: r.title as string, family: r.family as string | null, level: r.level as string | null,
    yearsMin: r.years_min as number | null, skills: JSON.parse(r.skills as string) as string[],
    blocker: r.blocker as string | null, workModel: r.work_model as string | null, location: r.location as string,
  }));
}

export function saveMatches(matches: Array<{ jobId: string; match: Match }>, replaceAll: boolean, unscored: string[] = []): void {
  const d = db();
  transaction(() => {
    if (replaceAll) d.exec("DELETE FROM matches");
    const drop = d.prepare("DELETE FROM matches WHERE job_id = ?");
    for (const id of unscored) drop.run(id);
    const insert = d.prepare("INSERT OR REPLACE INTO matches (job_id, score, detail) VALUES (?, ?, ?)");
    for (const m of matches) insert.run(m.jobId, m.match.score, JSON.stringify(m.match));
  });
}

const CARD_COLUMNS = `j.id, j.title, j.company, j.location, j.country, j.work_model, j.employment_type, j.level, j.years_min,
  j.pay_min, j.pay_max, j.pay_currency, j.pay_period, j.posted_at, j.first_seen_at, j.seen_new, j.url, j.ats, j.sponsorship, j.e_verify,
  j.blocker, j.h1b_filings, j.cap_exempt, j.closed_at, j.description_html = '' AS unread, m.detail AS match_detail, a.status AS status`;

function card(r: Row): JobCard {
  return {
    id: r.id as string, title: r.title as string, company: r.company as string, location: r.location as string,
    country: r.country as JobCard["country"], workModel: r.work_model as JobCard["workModel"],
    employmentType: r.employment_type as string | null, level: r.level as JobCard["level"],
    yearsMin: r.years_min as number | null, payMin: r.pay_min as number | null, payMax: r.pay_max as number | null,
    payCurrency: r.pay_currency as string | null, payPeriod: r.pay_period as JobCard["payPeriod"],
    postedAt: r.posted_at as string | null, firstSeenAt: r.first_seen_at as string, seenNew: r.seen_new === 1, url: r.url as string,
    ats: r.ats as Ats, unread: r.unread === 1, sponsorship: r.sponsorship as JobCard["sponsorship"],
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
  /** Only jobs from boards on these providers ("greenhouse", "workday"): some take far longer to apply through. */
  boards?: string[];
  /** Only jobs Jobhunt first saw after this moment (alerts). */
  firstSeenAfter?: string;
  sort?: "recommended" | "newest" | "score";
  limit?: number;
  offset?: number;
};

/**
 * A filter as the feed's address carries it ("q=analyst&work=remote&h1b=1"). The two filters the person has not set
 * themselves follow the profile.
 */
export function filterFromParams(p: URLSearchParams, profile: Profile): FeedFilter {
  const list = (k: string) => (p.get(k) ?? "").split(",").filter(Boolean);
  const on = (k: string) => p.get(k) === "1";
  const sort = p.get("sort");
  return {
    q: p.get("q") ?? "",
    workModels: list("work"),
    levels: list("level"),
    boards: list("ats"),
    postedWithinDays: Number(p.get("days")) || undefined,
    usOnly: p.has("us") ? on("us") : profile.usOnly,
    hideBlocked: p.has("hideBlocked") ? on("hideBlocked") : profile.needsSponsorship,
    h1bOnly: on("h1b"),
    eVerifyOnly: on("everify"),
    capExemptOnly: on("capExempt"),
    payListed: on("pay"),
    minScore: Number(p.get("minScore")) || undefined,
    sort: sort === "newest" || sort === "score" ? sort : "recommended",
    limit: Math.min(400, Number(p.get("limit")) || 40),
    offset: Number(p.get("offset")) || 0,
  };
}

/** Job cards by id, in the order given. */
export function cardsById(ids: string[]): JobCard[] {
  if (!ids.length) return [];
  const rows = db().prepare(`SELECT ${CARD_COLUMNS} FROM jobs j LEFT JOIN matches m ON m.job_id = j.id
    LEFT JOIN applications a ON a.job_id = j.id WHERE j.id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Row[];
  const byId = new Map(rows.map((r) => [r.id as string, card(r)]));
  return ids.map((id) => byId.get(id)).filter((j): j is JobCard => j !== undefined);
}

export type Feed = { total: number; jobs: JobCard[]; openJobs: number; newToday: number; strong: number; blocked: number; employers: number };

const DAY = 86_400_000;

// The four numbers above the feed are the same whatever the filters, and counting them walks every open job, so one
// count serves the requests of the next few seconds.
const statsCache = globalThis as unknown as { __jobhuntStats?: { at: number; stats: Row } };

function feedStats(now: number): Row {
  const cached = statsCache.__jobhuntStats;
  if (cached && now - cached.at < 30_000) return cached.stats;
  const d = db();
  const stats = d.prepare(`SELECT COUNT(*) AS open,
      SUM(CASE WHEN ${POSTED} >= ? THEN 1 ELSE 0 END) AS fresh,
      SUM(CASE WHEN j.blocker IS NOT NULL THEN 1 ELSE 0 END) AS blocked,
      COUNT(DISTINCT j.board_id) AS employers
    FROM jobs j WHERE j.closed_at IS NULL AND j.board_id IN (SELECT id FROM active_boards)`).get(new Date(now - DAY).toISOString()) as Row;
  // Both sides are read from their small indexes. Starting from the scores instead means fetching each strong job's
  // full row (its posting text) to see whether it is open, which takes seconds and holds everything else up.
  stats.strong = (d.prepare(`SELECT COUNT(*) AS n FROM jobs j INDEXED BY jobs_feed JOIN matches m INDEXED BY matches_by_job ON m.job_id = j.id
    WHERE j.closed_at IS NULL AND j.board_id IN (SELECT id FROM active_boards) AND m.score >= 80`).get() as { n: number }).n;
  statsCache.__jobhuntStats = { at: now, stats };
  return stats;
}

const countCache = new Map<string, { at: number; n: number }>();

export function feed(f: FeedFilter): Feed {
  // Jobs already applied to (or further along) live in the tracker, not the feed.
  const where = ["j.closed_at IS NULL", "j.board_id IN (SELECT id FROM active_boards)", "j.id NOT IN (SELECT job_id FROM applications WHERE status != 'saved')"];
  const args: Array<string | number> = [];
  for (const word of (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
    where.push("(lower(j.title) LIKE ? OR lower(j.company) LIKE ? OR lower(j.location) LIKE ? OR lower(j.department) LIKE ?)");
    const like = `%${word.replace(/[%_]/g, "")}%`;
    args.push(like, like, like, like);
  }
  const inList = (column: string, values: string[] | undefined, close = "") => {
    if (!values?.length) return;
    where.push(`${column} IN (${values.map(() => "?").join(",")})${close}`);
    args.push(...values);
  };
  inList("j.work_model", f.workModels);
  inList("j.level", f.levels);
  if (f.firstSeenAfter) { where.push("j.first_seen_at > ?"); args.push(f.firstSeenAfter); }
  if (f.postedWithinDays) {
    where.push(`${POSTED} >= ?`);
    args.push(new Date(Math.floor(Date.now() / 60_000) * 60_000 - f.postedWithinDays * DAY).toISOString());
  }
  // A bare "Remote" names no country, so it stays in.
  if (f.usOnly) where.push("j.country != 'other'");
  if (f.hideBlocked) where.push("j.blocker IS NULL");
  if (f.h1bOnly) where.push("j.h1b_filings > 0 AND j.blocker IS NULL");
  if (f.eVerifyOnly) where.push("j.e_verify = 1");
  if (f.capExemptOnly) where.push("j.cap_exempt = 1");
  if (f.payListed) where.push("j.pay_min IS NOT NULL");
  if (f.minScore) { where.push("m.score >= ?"); args.push(f.minScore); }

  inList("j.board_id IN (SELECT id FROM boards WHERE ats", f.boards, ")");

  const d = db();
  // Named outright: left to itself the database looks the score up in the full match rows, which is the slow way.
  const scores = "LEFT JOIN matches m INDEXED BY matches_by_job ON m.job_id = j.id";
  const from = `FROM jobs j ${scores} WHERE ${where.join(" AND ")}`;
  // Counting needs the scores only when the filter asks for one.
  // Counting walks every open job, so a count is kept for half a minute: paging and the redraws during a refresh
  // ask for the same one again and again.
  const countKey = `${f.minScore ? "m" : ""}|${where.join("&")}|${args.join("\u0001")}`;
  const counted = countCache.get(countKey);
  const total = counted && Date.now() - counted.at < 30_000 ? counted.n
    : (d.prepare(`SELECT COUNT(*) AS n FROM jobs j ${f.minScore ? `${scores} ` : ""}WHERE ${where.join(" AND ")}`).get(...args) as { n: number }).n;
  if (!counted || Date.now() - counted.at >= 30_000) {
    if (countCache.size > 200) countCache.clear();
    countCache.set(countKey, { at: Date.now(), n: total });
  }
  // The order is worked out in the database, on a few small columns, and only as far down as the page being shown:
  // with hundreds of thousands of jobs, reading them all out to sort them here is what takes the time.
  type Light = { id: string; company: string; at: number; score: number | null };
  const now = Date.now();
  const offset = f.offset ?? 0;
  const limit = f.limit ?? 40;
  const sort = f.sort ?? "recommended";
  const scored = (d.prepare("SELECT EXISTS (SELECT 1 FROM matches) AS n").get() as { n: number }).n === 1;
  const light = (order: string, take: number, skip: number, extra: Array<string | number> = []) =>
    (d.prepare(`SELECT j.id, j.company, ${POSTED} AS at, m.score ${from} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, ...extra, take, skip) as Row[])
      .map((r): Light => ({ id: r.id as string, company: r.company as string, at: r.at ? Date.parse(r.at as string) : 0, score: r.score as number | null }));
  let page: Light[];
  if (sort === "newest" || !scored) {
    page = light(`${POSTED} DESC, j.id`, limit, offset);
  } else if (sort === "score") {
    page = light(`m.score DESC, ${POSTED} DESC, j.id`, limit, offset);
  } else {
    // Recommended: the score, a little extra for fresh postings, and less for each further posting from an employer
    // that is already on the page, so one company with twenty openings does not take the whole top of the feed.
    // The spreading is done over the best few thousand, which is far more than anyone pages through.
    const base = `(COALESCE(m.score, 0) + CASE WHEN ${POSTED} >= ? THEN 3 WHEN ${POSTED} >= ? THEN 1 ELSE 0 END)`;
    const fresh = [new Date(now - 3 * DAY).toISOString(), new Date(now - 7 * DAY).toISOString()];
    const pool = light(`${base} DESC, ${POSTED} DESC, j.id`, Math.max(3000, (offset + limit) * 8), 0, fresh);
    const value = (j: Light) => (j.score ?? 0) + (now - j.at < 3 * DAY ? 3 : now - j.at < 7 * DAY ? 1 : 0);
    const seen = new Map<string, number>();
    const rank = new Map<string, number>();
    for (const j of pool) {
      const n = seen.get(j.company) ?? 0;
      seen.set(j.company, n + 1);
      rank.set(j.id, value(j) - 4 * Math.min(n, 6));
    }
    pool.sort((x, y) => rank.get(y.id)! - rank.get(x.id)! || y.at - x.at || x.id.localeCompare(y.id));
    page = pool.slice(offset, offset + limit);
  }
  const pageIds = page.map((j) => j.id);
  const cards = new Map<string, JobCard>();
  if (pageIds.length) {
    const rows = d.prepare(`SELECT ${CARD_COLUMNS} FROM jobs j LEFT JOIN matches m ON m.job_id = j.id
      LEFT JOIN applications a ON a.job_id = j.id WHERE j.id IN (${pageIds.map(() => "?").join(",")})`).all(...pageIds) as Row[];
    for (const r of rows) cards.set(r.id as string, card(r));
  }
  const stats = feedStats(now);
  return {
    total, jobs: pageIds.map((id) => cards.get(id)).filter((j): j is JobCard => j !== undefined),
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
