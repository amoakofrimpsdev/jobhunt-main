// The resume library: files the person uploads, and files in a folder they point the app at. Each one is read once
// into its skills, titles and years, so any job can be scored against every resume in an instant.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { scoreJob, scorerFor, type ScoredJob } from "./match";
import { proposeProfile, RESUME_FILE, resumeText } from "./resume";
import { dataDir, db, getMeta, getProfile, setMeta } from "./store";
import { skillName } from "./taxonomy";
import type { Profile, Resume, ResumeFit } from "./types";

type Row = Record<string, unknown>;
const MAX_BYTES = 8_000_000;
const MAX_FOLDER_FILES = 60;

const toResume = (r: Row): Resume => ({
  id: r.id as string, name: r.name as string, source: r.source as Resume["source"],
  skills: JSON.parse(r.skills as string) as string[], titles: JSON.parse(r.titles as string) as string[],
  years: r.years as number | null, addedAt: r.added_at as string,
});

export function listResumes(): Resume[] {
  return (db().prepare("SELECT * FROM resumes ORDER BY name COLLATE NOCASE").all() as Row[]).map(toResume);
}

async function save(id: string, name: string, source: Resume["source"], path: string, mtime: number, file: Buffer): Promise<void> {
  const text = await resumeText(file, name);
  if (text.length < 80) throw new Error(`No text could be read from ${name}. A scanned PDF is a picture; export the resume as a text PDF.`);
  const p = proposeProfile(text);
  db().prepare(`INSERT INTO resumes (id, name, source, path, mtime, text, skills, titles, years, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, path = excluded.path, mtime = excluded.mtime, text = excluded.text,
      skills = excluded.skills, titles = excluded.titles, years = excluded.years`)
    .run(id, name, source, path, mtime, text, JSON.stringify(p.skills), JSON.stringify(p.targetTitles), p.years, new Date().toISOString());
}

/** Keeps a copy of an uploaded resume in the data folder and reads it. */
export async function addUpload(name: string, file: Buffer): Promise<void> {
  if (!RESUME_FILE.test(name)) throw new Error(`${name}: a resume must be a PDF, a Word (.docx) file or plain text.`);
  if (file.length > MAX_BYTES) throw new Error(`${name} is larger than 8 MB.`);
  const dir = join(dataDir(), "resumes");
  mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  const path = join(dir, `${id}${extname(name).toLowerCase()}`);
  writeFileSync(path, file);
  try {
    await save(id, name, "upload", path, Date.now(), file);
  } catch (e) {
    unlinkSync(path);
    throw e;
  }
}

/** Removes a resume from the library. An uploaded copy is deleted; a file in the person's folder is never touched. */
export function removeResume(id: string): void {
  const row = db().prepare("SELECT source, path FROM resumes WHERE id = ?").get(id) as { source: string; path: string } | undefined;
  if (!row) return;
  db().prepare("DELETE FROM resumes WHERE id = ?").run(id);
  if (row.source === "upload" && existsSync(row.path)) unlinkSync(row.path);
  if (row.source === "folder") setMeta("resumeFolderHidden", [...new Set([...getMeta<string[]>("resumeFolderHidden", []), row.path])]);
}

export function resumeFolder(): string | null {
  return getMeta<string | null>("resumeFolder", null);
}

/**
 * Points the library at a folder ("~/Documents/Resumes"), or at none. Throws when the folder cannot be read.
 * Changing the folder forgets the resumes that came from the old one.
 */
export async function setResumeFolder(input: string | null): Promise<{ read: number; problems: string[] }> {
  const path = input?.trim() ? resolve(input.trim().replace(/^~(?=$|\/)/, homedir())) : null;
  if (path && !(existsSync(path) && statSync(path).isDirectory())) throw new Error(`${path} is not a folder on this computer.`);
  if (path !== resumeFolder()) {
    db().prepare("DELETE FROM resumes WHERE source = 'folder'").run();
    setMeta("resumeFolderHidden", []);
  }
  setMeta("resumeFolder", path);
  return scanResumeFolder();
}

/** Reads new and changed resumes in the folder and drops the ones that are gone. Subfolders are not read. */
export async function scanResumeFolder(): Promise<{ read: number; problems: string[] }> {
  const folder = resumeFolder();
  if (!folder || !existsSync(folder)) return { read: 0, problems: [] };
  const hidden = new Set(getMeta<string[]>("resumeFolderHidden", []));
  const known = new Map((db().prepare("SELECT id, path, mtime FROM resumes WHERE source = 'folder'").all() as Array<{ id: string; path: string; mtime: number }>).map((r) => [r.path, r]));
  const files = readdirSync(folder).filter((f) => RESUME_FILE.test(f) && !f.startsWith(".") && !f.startsWith("~$")).sort().slice(0, MAX_FOLDER_FILES);
  const problems: string[] = [];
  let read = 0;
  const seen = new Set<string>();
  for (const f of files) {
    const path = join(folder, f);
    seen.add(path);
    if (hidden.has(path)) continue;
    const stat = statSync(path);
    const had = known.get(path);
    if (!stat.isFile() || (had && had.mtime === Math.round(stat.mtimeMs))) continue;
    if (stat.size > MAX_BYTES) { problems.push(`${f} is larger than 8 MB.`); continue; }
    try {
      await save(had?.id ?? `folder:${f}`, basename(f), "folder", path, Math.round(stat.mtimeMs), readFileSync(path));
      read++;
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  for (const [path, r] of known) if (!seen.has(path)) db().prepare("DELETE FROM resumes WHERE id = ?").run(r.id);
  return { read, problems };
}

/** The profile a resume stands for: its own skills and titles, the person's own level and sponsorship answers. */
function profileOf(resume: Resume, main: Profile): Profile {
  return {
    ...main,
    skills: resume.skills,
    targetTitles: resume.titles.length ? resume.titles : main.targetTitles,
    years: main.years ?? resume.years,
  };
}

/**
 * How every resume in the library scores on one job, best first. `mainScore` is the main profile's score: a resume
 * is marked better only when it beats that.
 */
export function resumeFits(job: ScoredJob, mainScore: number | null): ResumeFit[] {
  const resumes = listResumes();
  if (!resumes.length) return [];
  const main = getProfile();
  const mine = new Set(main.skills);
  const asked = new Set(job.skills.slice(0, 12));
  const fits: ResumeFit[] = [];
  for (const r of resumes) {
    const match = scoreJob(scorerFor(profileOf(r, main)), job);
    if (!match) continue;
    const matched = r.skills.filter((s) => asked.has(s));
    fits.push({
      id: r.id, name: r.name, score: match.score, band: match.band,
      matched: matched.map(skillName), extra: matched.filter((s) => !mine.has(s)).map(skillName),
      better: mainScore === null || match.score > mainScore,
    });
  }
  return fits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
