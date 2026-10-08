// The Claude Desktop connector, app side: where the connector finds the running app, the entry written into Claude
// Desktop's own config when the person asks for it, and what each connector tool answers.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { claudeDesktopPrompt, jobBrief, unsupportedClaims } from "./ai";
import { BLOCKER_LABEL, payLabel } from "./client";
import { isDocumentKind, saveDocument } from "./documents";
import { listResumes, resumeFits } from "./resumes";
import { dataDir, db, feed, getProfile, jobDetail, jobScoringFacts, track } from "./store";
import { skillName } from "./taxonomy";
import { DOCUMENT_LABEL, LEVEL_LABEL, TRACK_STATUSES, type DocumentKind, type JobCard, type TrackStatus } from "./types";

type Args = Record<string, unknown>;
type Run = { port: number; token: string; pid: number };
const runFile = () => join(dataDir(), "run.json");
const g = globalThis as unknown as { __jobhuntRun?: Run };

/** Written at start: the port this server listens on and a token made for this launch, readable by this user only. */
export function writeRunFile(): void {
  const port = Number(process.env.PORT) || 3000;
  g.__jobhuntRun = { port, token: randomBytes(24).toString("hex"), pid: process.pid };
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(runFile(), JSON.stringify(g.__jobhuntRun), { mode: 0o600 });
}

export function connectorTokenOk(token: string | null): boolean {
  const mine = g.__jobhuntRun?.token;
  if (!mine || !token || token.length !== mine.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(mine));
}

// ---------------------------------------------------------------- Claude Desktop's config

const claudeConfigFile = () => join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");

/** The command Claude Desktop runs: this very Node (in the app, its bundled copy) and the connector beside the app. */
function command(): { command: string; args: string[] } {
  return { command: process.execPath, args: [join(process.cwd(), "mcp", "jobhunt-mcp.cjs"), dataDir()] };
}

function readConfig(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Claude Desktop's config file (${file}) is not valid JSON, so Jobhunt left it alone. Fix or remove it, then try again.`);
  }
}

export type ConnectorStatus = { installed: boolean; claudeFound: boolean; configFile: string; config: string };

export function connectorStatus(): ConnectorStatus {
  const file = claudeConfigFile();
  const mine = command();
  let installed = false;
  try {
    const cur = (readConfig(file).mcpServers as Record<string, { command?: string; args?: string[] }> | undefined)?.jobhunt;
    installed = !!cur && cur.command === mine.command && JSON.stringify(cur.args) === JSON.stringify(mine.args);
  } catch { /* unreadable: not installed */ }
  return { installed, claudeFound: existsSync(dirname(file)), configFile: file, config: JSON.stringify({ jobhunt: mine }, null, 2) };
}

/** Writes the Jobhunt entry into Claude Desktop's config. Other entries are kept and the old file is copied aside. */
export function installConnector(): ConnectorStatus {
  const file = claudeConfigFile();
  const cfg = readConfig(file);
  const servers = cfg.mcpServers && typeof cfg.mcpServers === "object" ? (cfg.mcpServers as Record<string, unknown>) : {};
  cfg.mcpServers = { ...servers, jobhunt: command() };
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.jobhunt.bak`);
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return connectorStatus();
}

export { claudeDesktopPrompt };

// ---------------------------------------------------------------- the tools

function jobLine(j: JobCard): string {
  const bits = [
    `${j.title} — ${j.company}`, j.location || "place not stated", payLabel(j),
    j.postedAt ? `posted ${j.postedAt.slice(0, 10)}` : null,
    j.match ? `match ${j.match.score}% (${j.match.band})` : null,
    j.blocker ? BLOCKER_LABEL[j.blocker] : j.h1bFilings > 0 ? `H-1B filer (${j.h1bFilings} filings)` : null,
    j.capExempt ? "cap-exempt likely" : null, j.eVerify ? "E-Verify" : null, j.status ? `tracker: ${j.status}` : null,
  ].filter(Boolean);
  return `- ${bits.join(" · ")}\n  id: ${j.id}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const flag = (v: unknown) => (typeof v === "boolean" ? v : undefined);

/** Runs one connector tool and answers in plain text for Claude to read. Throws with a message Claude can relay. */
export function runTool(tool: string, args: Args): string {
  switch (tool) {
    case "search_jobs": {
      const profile = getProfile();
      const sort = str(args.sort);
      const r = feed({
        q: str(args.query), workModels: args.remote_only === true ? ["remote"] : [],
        usOnly: flag(args.us_only) ?? profile.usOnly, hideBlocked: flag(args.hide_visa_blockers) ?? profile.needsSponsorship,
        h1bOnly: args.h1b_filer_only === true, postedWithinDays: Number(args.posted_within_days) || undefined,
        minScore: Number(args.min_match) || undefined, sort: sort === "score" || sort === "newest" ? sort : "recommended",
        limit: Math.max(1, Math.min(30, Number(args.limit) || 12)),
      });
      if (!r.jobs.length) return "No open job in Jobhunt matches that.";
      return `${r.total.toLocaleString()} jobs match; the first ${r.jobs.length}:\n${r.jobs.map(jobLine).join("\n")}`;
    }
    case "get_job": {
      const id = str(args.job_id);
      const job = jobDetail(id);
      const facts = jobScoringFacts(id);
      const brief = jobBrief(id);
      if (!job || !facts || !brief) throw new Error("No job in Jobhunt has that id. Use search_jobs to find it.");
      const fits = resumeFits(facts, job.match?.score ?? null);
      const lines = [
        jobLine(job), `Apply: ${job.applyUrl}`,
        job.level ? `Level: ${LEVEL_LABEL[job.level]}` : null, job.yearsMin !== null ? `Asks for ${job.yearsMin}+ years` : null,
        job.match ? `Match ${job.match.score}%: ${job.match.parts.map((p) => `${p.label} ${p.score ?? "not scored"} (${p.reasons.join(" ")})`).join("; ")}` : "Not scored: the profile is empty.",
        job.match?.cap ?? null,
        ...Object.entries(job.evidence).map(([k, v]) => `The posting on ${k}: "${v}"`),
        job.skills.length ? `Skills the posting names: ${job.skills.map((s) => `${s.name}${s.have ? " (has)" : ""}`).join(", ")}` : null,
        fits.length ? `Resumes, best first: ${fits.map((f) => `${f.name} ${f.score}%`).join(", ")}` : "The resume library is empty.",
        `\nPOSTING:\n${brief.posting}`,
        `\nRESUME TO START FROM${brief.resumeName ? ` (${brief.resumeName})` : " (from the profile; no resume file in the library)"}:\n${brief.resume}`,
      ];
      return lines.filter(Boolean).join("\n");
    }
    case "get_profile": {
      const p = getProfile();
      return [
        `Name: ${p.name || "not set"}`, `Target titles: ${p.targetTitles.join(", ") || "none"}`,
        `Skills: ${p.skills.map(skillName).join(", ") || "none"}`, `Years of experience: ${p.years ?? "not set"}`,
        `Level: ${p.level ? LEVEL_LABEL[p.level] : "from years"}`, `Needs visa sponsorship: ${p.needsSponsorship ? "yes" : "no"}`,
        `United States jobs only: ${p.usOnly ? "yes" : "no"}`,
      ].join("\n");
    }
    case "list_resumes": {
      const resumes = listResumes();
      if (!resumes.length) return "The resume library is empty. The person can add resumes on Jobhunt's Profile page.";
      return resumes.map((r) => `- ${r.name}\n  id: ${r.id}\n  titles: ${r.titles.join(", ") || "none read"}\n  skills: ${r.skills.map(skillName).join(", ")}`).join("\n");
    }
    case "get_resume": {
      const row = db().prepare("SELECT name, text FROM resumes WHERE id = ?").get(str(args.resume_id)) as { name: string; text: string } | undefined;
      if (!row) throw new Error("No resume has that id. Use list_resumes.");
      return `${row.name}\n\n${row.text}`;
    }
    case "save_document": {
      const kind = args.kind;
      const content = str(args.content).trim();
      const brief = jobBrief(str(args.job_id));
      if (!brief) throw new Error("No job in Jobhunt has that id.");
      if (!isDocumentKind(kind)) throw new Error("kind must be fit, resume, cover or message.");
      if (content.length < 40) throw new Error("The content is too short to save.");
      const warnings = unsupportedClaims(kind as DocumentKind, content, brief);
      saveDocument({ jobId: brief.jobId, kind, content: content.slice(0, 40_000), source: "claude-desktop", resumeName: brief.resumeName, warnings });
      const saved = `Saved the ${DOCUMENT_LABEL[kind].toLowerCase()} on ${brief.title} at ${brief.company} in Jobhunt.`;
      return warnings.length ? `${saved}\nCheck these against the resume, and save a corrected version if they are not true: ${warnings.join(" ")}` : saved;
    }
    case "update_tracker": {
      const status = args.status as TrackStatus;
      if (!TRACK_STATUSES.includes(status)) throw new Error("Unknown status.");
      if (!track(str(args.job_id), status, typeof args.notes === "string" ? args.notes.slice(0, 5000) : undefined)) throw new Error("No job in Jobhunt has that id.");
      return `The job is now ${status} in the tracker.`;
    }
    default:
      throw new Error(`Jobhunt has no tool called ${tool}.`);
  }
}
