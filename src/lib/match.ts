// The match score: three parts (role, skills, level), a percent, a band, and a reason for every number. No model is
// asked: the same profile and posting always give the same score, and it costs nothing to compute.
import { levelOfYears } from "./parse/facts";
import { familyLabel, familyOfTitle, familyRelatedness, skillName, skillsRelated, titleWords } from "./taxonomy";
import { LEVEL_LABEL, type Band, type Level, type Match, type MatchPart, type Profile } from "./types";

export type ScoredJob = { title: string; family: string | null; level: string | null; yearsMin: number | null; skills: string[]; blocker: string | null };

type Target = { title: string; words: string[]; family: string | null };
export type Scorer = { profile: Profile; targets: Target[]; skills: Set<string>; level: Level | null };

export function scorerFor(profile: Profile): Scorer {
  return {
    profile,
    targets: profile.targetTitles.map((title) => ({ title, words: titleWords(title), family: familyOfTitle(title)?.family ?? null })).filter((t) => t.words.length > 0),
    skills: new Set(profile.skills),
    level: profile.level ?? (profile.years === null ? null : levelOfYears(profile.years)),
  };
}

const WEIGHT = { role: 0.45, skills: 0.35, level: 0.2 } as const;
const ORD: Record<Level, number> = { intern: 0, entry: 1, mid: 2, senior: 3, staff: 4, manager: 4, director: 5, exec: 6 };
const BLOCKER_WORDS: Record<string, string> = {
  no_sponsorship: "The posting says it does not sponsor visas",
  citizenship: "The posting asks for US citizenship",
  clearance: "The posting asks for a security clearance",
};

export function bandFor(score: number): Band {
  return score >= 80 ? "strong" : score >= 65 ? "good" : score >= 50 ? "fair" : "low";
}

function rolePart(s: Scorer, job: ScoredJob): MatchPart {
  const part: MatchPart = { key: "role", label: "Role", score: null, reasons: [] };
  if (!s.targets.length) { part.reasons.push("Add a target job title to your profile to score the role."); return part; }
  const words = new Set(titleWords(job.title));
  let best = -1;
  for (const t of s.targets) {
    const overlap = t.words.filter((w) => words.has(w)).length / t.words.length;
    let score: number, reason: string;
    if (t.family && job.family && t.family === job.family) {
      score = 60 + 40 * overlap;
      reason = overlap === 1 ? `The title matches your target “${t.title}”.` : `Same kind of work as your target “${t.title}” (${familyLabel(job.family)}).`;
    } else if (t.family && job.family) {
      const rel = familyRelatedness(t.family, job.family);
      score = 20 + 50 * rel + 15 * overlap;
      reason = rel > 0
        ? `${familyLabel(job.family)} is related to your target “${t.title}” (${familyLabel(t.family)}), not the same work.`
        : `${familyLabel(job.family)} is a different kind of work from your target “${t.title}”.`;
    } else {
      score = 20 + 65 * overlap;
      reason = overlap > 0 ? `The title shares words with your target “${t.title}”.` : `The title has nothing in common with your target “${t.title}”.`;
    }
    if (score > best) { best = score; part.reasons = [reason]; }
  }
  part.score = Math.round(Math.min(100, best));
  return part;
}

function skillsPart(s: Scorer, job: ScoredJob): { part: MatchPart; matched: string[]; missing: string[] } {
  const part: MatchPart = { key: "skills", label: "Skills", score: null, reasons: [] };
  const asked = job.skills.slice(0, 12);
  if (!s.skills.size) { part.reasons.push("Add skills to your profile to score this part."); return { part, matched: [], missing: asked }; }
  if (asked.length < 3) { part.reasons.push("The posting names too few skills to compare."); return { part, matched: asked.filter((k) => s.skills.has(k)), missing: [] }; }
  const matched: string[] = [], close: string[] = [], missing: string[] = [];
  let got = 0, total = 0;
  asked.forEach((skill, i) => {
    // Skills are in order of how often the posting names them; the first five count double.
    const w = i < 5 ? 2 : 1;
    total += w;
    if (s.skills.has(skill)) { matched.push(skill); got += w; return; }
    const near = [...s.skills].find((mine) => skillsRelated(mine, skill));
    if (near) { close.push(`${skillName(skill)} (you have ${skillName(near)})`); got += w / 2; } else missing.push(skill);
  });
  part.score = Math.round((100 * got) / total);
  part.reasons.push(`You have ${matched.length} of the ${asked.length} skills the posting names most.`);
  if (close.length) part.reasons.push(`Close: ${close.slice(0, 3).join(", ")}.`);
  return { part, matched, missing };
}

function levelPart(s: Scorer, job: ScoredJob): MatchPart {
  const part: MatchPart = { key: "level", label: "Level", score: null, reasons: [] };
  const years = s.profile.years;
  const jobLevel = job.level as Level | null;
  if (s.level === null && years === null) { part.reasons.push("Add your years of experience to score the level."); return part; }
  if (job.yearsMin === null && jobLevel === null) { part.reasons.push("The posting does not say what level it is."); return part; }
  let score = 100;
  if (job.yearsMin !== null && years !== null) {
    const gap = job.yearsMin - years;
    score = gap <= 0 ? 100 : gap <= 1 ? 80 : gap <= 2 ? 60 : gap <= 3 ? 40 : 20;
    part.reasons.push(gap <= 0
      ? `It asks for ${job.yearsMin}+ years; you have ${years}.`
      : `It asks for ${job.yearsMin}+ years; you have ${years}, ${gap} short.`);
  }
  if (jobLevel !== null && s.level !== null) {
    const diff = ORD[jobLevel] - ORD[s.level];
    const byLevel = diff === 0 ? 100 : diff === 1 ? 70 : diff === 2 ? 35 : diff >= 3 ? 15 : diff === -1 ? 85 : diff === -2 ? 55 : 35;
    score = Math.min(score, byLevel);
    part.reasons.push(diff === 0
      ? `${LEVEL_LABEL[jobLevel]} role, the level you are at.`
      : diff > 0 ? `${LEVEL_LABEL[jobLevel]} role, above your level (${LEVEL_LABEL[s.level]}).` : `${LEVEL_LABEL[jobLevel]} role, below your level (${LEVEL_LABEL[s.level]}).`);
  }
  part.score = score;
  return part;
}

/** null when the profile has neither a target title nor skills: there is nothing to score against. */
export function scoreJob(s: Scorer, job: ScoredJob): Match | null {
  const role = rolePart(s, job);
  const { part: skills, matched, missing } = skillsPart(s, job);
  const level = levelPart(s, job);
  if (role.score === null && skills.score === null) return null;
  const parts = [role, skills, level];
  let sum = 0, weight = 0;
  // A part the posting gives nothing to judge by counts as a middling 60, so a job known only by its title cannot
  // reach the top of the feed. A part the profile cannot be scored on yet is left out.
  const unknown: Record<MatchPart["key"], number | null> = { role: null, skills: s.skills.size ? 60 : null, level: s.level !== null ? 60 : null };
  for (const p of parts) {
    const value = p.score ?? unknown[p.key];
    if (value !== null) { sum += value * WEIGHT[p.key]; weight += WEIGHT[p.key]; }
  }
  let score = Math.round(sum / weight);
  let cap: string | null = null;
  // Shared tools do not make a different job a good match.
  if (role.score !== null && role.score < 40 && score > 55) { score = 55; cap = "Held at 55% because the role is a different kind of work."; }
  if (s.profile.needsSponsorship && job.blocker) {
    score = Math.min(score, 20);
    cap = `${BLOCKER_WORDS[job.blocker] ?? "The posting rules out sponsorship"}, and your profile says you need sponsorship.`;
  }
  return { score, band: bandFor(score), parts, matchedSkills: matched, missingSkills: missing, cap };
}
