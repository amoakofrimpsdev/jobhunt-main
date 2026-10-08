import { createOpenAIClient } from "./openaiClient";
import { query } from "./db";
import { defaultJobSources } from "./seedJobSources";
import type { JobListing } from "./database";

type JobSourceRow = {
  id: string | number;
  name: string;
  url: string;
  type?: string | null;
  last_run?: string | null;
};

const CRAWL4AI_KEY = process.env.CRAWL4AI_API_KEY;
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;

async function fetchWithCrawl4AI(url: string): Promise<string> {
  if (!CRAWL4AI_KEY) {
    throw new Error("Missing CRAWL4AI_API_KEY for Crawl4AI scraping.");
  }

  const response = await fetch("https://api.crawl4.ai/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRAWL4AI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, render: true, output: "markdown" }),
  });

  if (!response.ok) {
    throw new Error(`Crawl4AI request failed with status ${response.status}`);
  }

  const payload = await response.json();
  return String(payload?.content ?? payload?.result ?? "");
}

async function fetchWithFirecrawl(url: string): Promise<string> {
  if (!FIRECRAWL_KEY) {
    throw new Error("Missing FIRECRAWL_API_KEY for Firecrawl scraping.");
  }

  const response = await fetch("https://api.firecrawl.ai/v1/extract", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, format: "markdown" }),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl request failed with status ${response.status}`);
  }

  const payload = await response.json();
  return String(payload?.markdown ?? payload?.content ?? "");
}

async function fetchPageContent(url: string): Promise<string> {
  if (process.env.USE_FIRECRAWL === "true") {
    return await fetchWithFirecrawl(url);
  }

  if (process.env.USE_CRAWL4AI === "true") {
    return await fetchWithCrawl4AI(url);
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "JobHuntBot/1.0 (+https://github.com/Daniel-Frimpong-tech/jobhunt)",
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch ${url}: ${response.status}`);
  }

  return await response.text();
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    const jsonMatch = value.match(/\{[\s\S]*\}/);
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

async function extractJobMetadata(source: JobSourceRow, content: string): Promise<Partial<JobListing>> {
  const prompt = `Extract the most relevant job posting details from the following scraped content. Respond with valid JSON only. Use empty strings for missing text fields, false for boolean fields, and the exact options for experience_level: junior, mid, senior, unknown. The fields are:\n\n- title\n- company\n- description\n- location\n- requirements\n- sponsorship_offered (yes, no, unknown)\n- clearance_required\n- citizenship_required\n- experience_level\n- date_posted\n- application_url\n\nContent:\n${content}`;

  const openai = createOpenAIClient();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You extract structured job metadata from scraped career pages and social media posts." },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    max_tokens: 650,
  });

  const rawText = String(completion.choices?.[0]?.message?.content ?? "");
  const result = safeJsonParse<Partial<JobListing>>(rawText);

  if (!result) {
    throw new Error("Unable to parse job metadata from OpenAI response.");
  }

  return {
    title: result.title ?? "",
    company: result.company ?? "",
    description: result.description ?? "",
    location: result.location ?? null,
    requirements: result.requirements ?? "",
    sponsorship_offered: result.sponsorship_offered ?? "unknown",
    clearance_required: result.clearance_required ?? false,
    citizenship_required: result.citizenship_required ?? false,
    experience_level: result.experience_level ?? "unknown",
    date_posted: result.date_posted ?? null,
    application_url: result.application_url ?? "",
  };
}

async function verifyApplicationUrl(url: string): Promise<boolean> {
  if (!url) {
    return false;
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
    });
    return response.ok;
  } catch {
    return false;
  }
}

function normalizeJobSource(source: any): JobSourceRow {
  return {
    id: source.id,
    name: source.name ?? "Unnamed source",
    url: source.url,
    type: source.type ?? source.source_type ?? "career_page",
    last_run: source.last_run ?? source.last_scraped_at ?? null,
  };
}

export async function getActiveJobSources(): Promise<JobSourceRow[]> {
  try {
    const res = await query("SELECT id, name, url, type, last_run FROM job_sources");
    if (!res || !res.rows || res.rows.length === 0) {
      return defaultJobSources.map(normalizeJobSource);
    }
    return (res.rows as any[]).map(normalizeJobSource);
  } catch (err) {
    console.warn("Unable to fetch job sources from Postgres:", String(err));
    return defaultJobSources.map(normalizeJobSource);
  }
}

export async function crawlAndIngestJobs() {
  const sources = await getActiveJobSources();
  const output: Array<{ source: string; jobs: number; error?: string }> = [];
  let totalJobs = 0;

  for (const source of sources) {
    try {
      const scrapedText = await fetchPageContent(source.url);
      const parsedJob = await extractJobMetadata(source, scrapedText);
      const isVerified = await verifyApplicationUrl(parsedJob.application_url ?? "");

      const applicationUrl = parsedJob.application_url ?? "";
      if (!applicationUrl) {
        throw new Error("No application URL found in extracted metadata.");
      }

      const payload = {
        source_id: source.id,
        title: parsedJob.title ?? "",
        company: parsedJob.company ?? "",
        description: parsedJob.description ?? "",
        location: parsedJob.location ?? null,
        requirements: parsedJob.requirements ?? "",
        sponsorship_offered: parsedJob.sponsorship_offered ?? "unknown",
        clearance_required: parsedJob.clearance_required ?? false,
        citizenship_required: parsedJob.citizenship_required ?? false,
        experience_level: parsedJob.experience_level ?? "unknown",
        date_posted: parsedJob.date_posted ?? null,
        application_url: applicationUrl,
        extra: JSON.stringify({ source: source.url, content_snippet: scrapedText.slice(0, 2048) }),
      };

      await query(
        `INSERT INTO job_listings (source_id,title,company,description,location,requirements,sponsorship_offered,clearance_required,citizenship_required,experience_level,date_posted,application_url,extra,scraped_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
         ON CONFLICT (application_url) DO UPDATE SET
           title = EXCLUDED.title,
           company = EXCLUDED.company,
           description = EXCLUDED.description,
           location = EXCLUDED.location,
           requirements = EXCLUDED.requirements,
           sponsorship_offered = EXCLUDED.sponsorship_offered,
           clearance_required = EXCLUDED.clearance_required,
           citizenship_required = EXCLUDED.citizenship_required,
           experience_level = EXCLUDED.experience_level,
           date_posted = EXCLUDED.date_posted,
           extra = EXCLUDED.extra,
           scraped_at = now();`,
        [
         payload.source_id,
         payload.title,
         payload.company,
         payload.description,
         payload.location,
         payload.requirements,
         payload.sponsorship_offered,
         payload.clearance_required,
         payload.citizenship_required,
         payload.experience_level,
         payload.date_posted,
         payload.application_url,
         payload.extra,
        ],
      );

      totalJobs += 1;
      output.push({ source: source.name, jobs: 1 });

      await query("UPDATE job_sources SET last_run = now() WHERE id = $1", [source.id]);
    } catch (error) {
      output.push({ source: source.name, jobs: 0, error: String(error) });
    }
  }

  return {
    scraped_sources: sources.length,
    total_jobs_ingested: totalJobs,
    details: output,
  };
}
