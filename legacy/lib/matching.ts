import { createOpenAIClient } from "./openaiClient";
import { query } from "./db";
import type { JobListing, ResumeProfile } from "./database";

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    const jsonMatch = value.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!jsonMatch) {
      return null;
    }
    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      return null;
    }
  }
}

export type JobMatchResult = {
  score: number;
  summary: string;
  matched_skills: string[];
  missing_skills: string[];
};

const buildMatchPrompt = (job: JobListing, resume: ResumeProfile) => {
  const resumeSkills = resume.parsed_skills.length > 0 ? resume.parsed_skills.join(", ") : "none";
  const resumeExperience = resume.parsed_experience.length > 0
    ? resume.parsed_experience
        .map((item) => `${item.role} at ${item.company}${item.start_date ? ` (${item.start_date}` : ""}${item.end_date ? ` - ${item.end_date})` : item.start_date ? ")" : ""}: ${item.summary ?? ""}`)
        .join("\n")
    : "No experience details provided.";
  const resumeEducation = resume.parsed_education.length > 0
    ? resume.parsed_education
        .map((item) => `${item.institution}${item.degree ? `, ${item.degree}` : ""}${item.field ? ` (${item.field})` : ""}${item.years ? ` — ${item.years}` : ""}`)
        .join("\n")
    : "No education details provided.";

  return `You are an AI job matcher. Compare the following job posting to the candidate resume and return only valid JSON with the fields: score, summary, matched_skills, missing_skills.\n\nJob posting:\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location ?? "Unknown"}\nExperience level: ${job.experience_level}\nSponsorship offered: ${job.sponsorship_offered}\nClearance required: ${job.clearance_required}\nCitizenship required: ${job.citizenship_required}\nDescription: ${job.description}\nRequirements: ${job.requirements}\nApplication URL: ${job.application_url}\n\nResume summary:\nSkills: ${resumeSkills}\nExperience:\n${resumeExperience}\nEducation:\n${resumeEducation}\n\nReturn JSON only.\nscore should be an integer between 0 and 100.\nsummary should explain why this role is a good fit and what may be missing.\nmatched_skills should list skills from the resume that directly match the job requirements.\nmissing_skills should list relevant skills or qualifications the job asks for but the resume does not clearly show.\n`;
};

export async function computeMatchForJob(job: JobListing, resume: ResumeProfile): Promise<JobMatchResult> {
  const openai = createOpenAIClient();
  const prompt = buildMatchPrompt(job, resume);
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are an AI assistant that scores job fit between a resume and a job listing." },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    max_tokens: 450,
  });

  const rawText = String(completion.choices?.[0]?.message?.content ?? "");
  const result = safeJsonParse<JobMatchResult>(rawText);

  if (!result) {
    throw new Error("Unable to parse job match response from OpenAI.");
  }

  return {
    score: Number.isFinite(result.score) ? Math.max(0, Math.min(100, Math.round(result.score))) : 0,
    summary: result.summary ?? "No summary generated.",
    matched_skills: Array.isArray(result.matched_skills) ? result.matched_skills.filter(Boolean) : [],
    missing_skills: Array.isArray(result.missing_skills) ? result.missing_skills.filter(Boolean) : [],
  };
}

export async function getLatestResume(userId = "anonymous"): Promise<ResumeProfile | null> {
  try {
    const res = await query("SELECT * FROM resumes WHERE user_id = $1 ORDER BY uploaded_at DESC LIMIT 1", [userId]);
    if (!res || !res.rows || res.rows.length === 0) return null;
    const row = res.rows[0];
    const parsed = row.parsed ?? {};
    return {
      ...row,
      parsed_skills: Array.isArray(parsed.parsed_skills) ? parsed.parsed_skills : [],
      parsed_experience: Array.isArray(parsed.parsed_experience) ? parsed.parsed_experience : [],
      parsed_education: Array.isArray(parsed.parsed_education) ? parsed.parsed_education : [],
    } as ResumeProfile;
  } catch (err) {
    console.warn("Unable to fetch latest resume:", String(err));
    return null;
  }
}

export async function getJobsToMatch(): Promise<JobListing[]> {
  try {
    const res = await query("SELECT * FROM job_listings ORDER BY scraped_at DESC, id DESC");
    return (res.rows ?? []) as JobListing[];
  } catch (err) {
    console.warn("Unable to fetch job listings:", String(err));
    return [];
  }
}

export async function upsertJobMatch(userId: string, jobId: string, match: JobMatchResult) {
  try {
    await query(
      `INSERT INTO job_matches (user_id,job_id,score,summary,matched_skills,missing_skills,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (user_id,job_id) DO UPDATE SET
         score = EXCLUDED.score,
         summary = EXCLUDED.summary,
         matched_skills = EXCLUDED.matched_skills,
         missing_skills = EXCLUDED.missing_skills;`,
      [userId, jobId, match.score, match.summary, match.matched_skills, match.missing_skills],
    );
  } catch (err) {
    throw err;
  }
}

export async function computeMatchesForLatestResume(userId = "anonymous") {
  const resume = await getLatestResume(userId);
  if (!resume) {
    throw new Error("No resume found for the current user.");
  }

  const jobs = await getJobsToMatch();
  if (jobs.length === 0) {
    return { matched_jobs: 0, attempted: 0, message: "No job listings available to match." };
  }

  const results = [] as Array<{ job_id: string; score: number; summary: string }>;

  for (const job of jobs) {
    const match = await computeMatchForJob(job, resume);
    await upsertJobMatch(userId, job.id, match);
    results.push({ job_id: job.id, score: match.score, summary: match.summary });
  }

  return { matched_jobs: results.length, attempted: results.length, results };
}
