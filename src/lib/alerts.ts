// Alerts: a saved search that is run again after every refresh. Jobs that are new since its last run and match it
// are kept as hits, shown on the Alerts page, and announced with a notification on this computer. Nothing is sent
// anywhere: an alert is a row in the local database.
import { execFile } from "node:child_process";
import { cardsById, db, feed, filterFromParams, getProfile } from "./store";
import { LEVEL_LABEL, type JobCard, type Level } from "./types";

export type Alert = { id: number; name: string; params: string; summary: string; enabled: boolean; createdAt: string; lastRunAt: string; hits: number; unseen: number };
export type AlertHit = JobCard & { alertId: number; alertName: string; foundAt: string; seen: boolean };

/** Most new jobs one alert keeps from one refresh: the best matches. A first read of a big board is not 900 alerts. */
const HITS_PER_RUN = 40;

type Row = Record<string, unknown>;

/** What an alert looks for, in words. */
export function summarize(params: string): string {
  const p = new URLSearchParams(params);
  const list = (k: string) => (p.get(k) ?? "").split(",").filter(Boolean);
  const parts: string[] = [];
  if (p.get("q")) parts.push(`“${p.get("q")}”`);
  if (list("work").length) parts.push(list("work").map((w) => (w === "onsite" ? "on-site" : w)).join(" or "));
  if (list("level").length) parts.push(list("level").map((l) => LEVEL_LABEL[l as Level] ?? l).join(" or "));
  if (p.get("minScore")) parts.push(`match ${p.get("minScore")}% or more`);
  if (p.get("h1b") === "1") parts.push("H-1B filers");
  if (p.get("capExempt") === "1") parts.push("cap-exempt employers");
  if (p.get("everify") === "1") parts.push("E-Verify employers");
  if (p.get("pay") === "1") parts.push("pay listed");
  if (p.get("us") === "1") parts.push("United States");
  if (p.get("hideBlocked") === "1") parts.push("no visa blockers");
  return parts.length ? parts.join(" · ") : "Every new job";
}

export function listAlerts(): Alert[] {
  const rows = db().prepare(`SELECT a.*, (SELECT COUNT(*) FROM alert_hits h WHERE h.alert_id = a.id) AS hits,
    (SELECT COUNT(*) FROM alert_hits h WHERE h.alert_id = a.id AND h.seen = 0) AS unseen FROM alerts a ORDER BY a.created_at DESC`).all() as Row[];
  return rows.map((r) => ({
    id: r.id as number, name: r.name as string, params: r.filter as string, summary: summarize(r.filter as string), enabled: r.enabled === 1,
    createdAt: r.created_at as string, lastRunAt: r.last_run_at as string, hits: r.hits as number, unseen: r.unseen as number,
  }));
}

/** Keeps only the parts of a feed address that choose jobs; paging and order are not part of an alert. */
function clean(params: string): string {
  const p = new URLSearchParams(params);
  for (const k of ["limit", "offset", "sort", "days"]) p.delete(k);
  return p.toString();
}

export function createAlert(name: string, params: string): void {
  const now = new Date().toISOString();
  // It starts from now: jobs already in the feed are not "new".
  db().prepare("INSERT INTO alerts (name, filter, enabled, created_at, last_run_at) VALUES (?, ?, 1, ?, ?)").run(name.trim().slice(0, 80) || "My alert", clean(params), now, now);
}

export function setAlertEnabled(id: number, enabled: boolean): void {
  // Switched back on, it looks forward from now and does not report everything it missed.
  db().prepare("UPDATE alerts SET enabled = ?, last_run_at = CASE WHEN ? THEN ? ELSE last_run_at END WHERE id = ?").run(enabled ? 1 : 0, enabled ? 1 : 0, new Date().toISOString(), id);
}

export function removeAlert(id: number): void {
  db().prepare("DELETE FROM alerts WHERE id = ?").run(id);
}

export function unseenHits(): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM alert_hits WHERE seen = 0").get() as { n: number }).n;
}

export function markHitsSeen(): void {
  db().prepare("UPDATE alert_hits SET seen = 1 WHERE seen = 0").run();
}

/** The newest hits across all alerts, each job once. */
export function listHits(limit = 120): AlertHit[] {
  const rows = db().prepare(`SELECT h.job_id, h.alert_id, h.found_at, h.seen, a.name FROM alert_hits h JOIN alerts a ON a.id = h.alert_id
    ORDER BY h.found_at DESC, h.rowid LIMIT ?`).all(limit * 2) as Row[];
  const first = new Map<string, Row>();
  for (const r of rows) if (!first.has(r.job_id as string)) first.set(r.job_id as string, r);
  return cardsById([...first.keys()].slice(0, limit)).filter((j) => !j.closedAt)
    .map((j) => { const r = first.get(j.id)!; return { ...j, alertId: r.alert_id as number, alertName: r.name as string, foundAt: r.found_at as string, seen: r.seen === 1 }; });
}

function notify(title: string, message: string): void {
  if (process.platform !== "darwin") return;
  const quote = (s: string) => `"${s.replace(/[\\"]/g, " ")}"`;
  execFile("/usr/bin/osascript", ["-e", `display notification ${quote(message)} with title ${quote(title)}`], () => undefined);
}

/** Runs every switched-on alert over the jobs that arrived since it last ran. Returns how many new hits there are. */
export function runAlerts(): number {
  const d = db();
  const profile = getProfile();
  const now = new Date().toISOString();
  const add = d.prepare("INSERT OR IGNORE INTO alert_hits (alert_id, job_id, found_at, seen) VALUES (?, ?, ?, 0)");
  const ran = d.prepare("UPDATE alerts SET last_run_at = ? WHERE id = ?");
  let total = 0;
  const lines: string[] = [];
  for (const a of listAlerts().filter((x) => x.enabled)) {
    const filter = { ...filterFromParams(new URLSearchParams(a.params), profile), firstSeenAfter: a.lastRunAt, sort: "score" as const, limit: HITS_PER_RUN, offset: 0 };
    const found = feed(filter);
    let fresh = 0;
    for (const j of found.jobs) fresh += Number(add.run(a.id, j.id, now).changes);
    ran.run(now, a.id);
    if (fresh) { total += fresh; lines.push(`${fresh} for ${a.name}${found.jobs[0] ? `: ${found.jobs[0].title} at ${found.jobs[0].company}` : ""}`); }
  }
  // Old hits are dropped after a month, read or not.
  d.prepare("DELETE FROM alert_hits WHERE found_at < ?").run(new Date(Date.now() - 30 * 86_400_000).toISOString());
  if (total) notify(`Jobhunt: ${total} new ${total === 1 ? "job" : "jobs"}`, lines.slice(0, 3).join(". "));
  return total;
}
