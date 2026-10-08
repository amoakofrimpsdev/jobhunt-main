// The optional AI features. Match scores never use a model; these run only when the person clicks, with the
// provider they chose: a model on this computer, their own Anthropic or OpenAI key, or Claude Desktop through the
// connector (which does the writing itself and saves the result back, so this file only prepares its request).
import Anthropic from "@anthropic-ai/sdk";
import { saveDocument } from "./documents";
import { resumeFits } from "./resumes";
import { getSecret } from "./secrets";
import { db, getMeta, getProfile, jobScoringFacts, setMeta } from "./store";
import { scanSkills, skillName } from "./taxonomy";
import { htmlToText } from "./text";
import { DOCUMENT_LABEL, type AiSettings, type DocumentKind, type JobDocument } from "./types";

export const ANTHROPIC_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

const DEFAULTS: AiSettings = {
  provider: "none",
  localUrl: "http://localhost:11434",
  localModel: "",
  anthropicModel: "claude-opus-5-5",
  openaiModel: "gpt-4o",
};

export function aiSettings(): AiSettings {
  return { ...DEFAULTS, ...getMeta<Partial<AiSettings>>("ai", {}) };
}

export function saveAiSettings(s: AiSettings): AiSettings {
  setMeta("ai", s);
  return s;
}

/** Only a model on this computer may be reached over plain http. */
function localBase(url: string): string {
  const u = new URL(url);
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && u.protocol !== "https:") {
    throw new Error("A model on another computer must be reached over https.");
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")}`;
}

/** The models an OpenAI-compatible server offers (Ollama, LM Studio, llama.cpp). */
export async function localModels(url: string): Promise<string[]> {
  const res = await fetch(`${localBase(url)}/v1/models`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).map((m) => m.id ?? "").filter(Boolean).sort();
}

async function openAiCompatible(base: string, key: string | null, model: string, system: string, user: string): Promise<string> {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(600_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } | string };
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(message ?? `The model server answered ${res.status}.`);
  }
  // Local reasoning models put their thinking in the text between <think> tags; it is not part of the answer.
  const text = (body.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text) throw new Error("The model answered with nothing.");
  return text;
}

async function claude(key: string, model: string, system: string, user: string): Promise<string> {
  const client = new Anthropic({ apiKey: key });
  const request = { model, max_tokens: 16000, system, messages: [{ role: "user" as const, content: user }] };
  try {
    const read = (m: { stop_reason: string | null; content: Array<{ type: string; text?: string }> }) => ({
      refused: m.stop_reason === "refusal",
      text: m.content.map((block) => (block.type === "text" ? block.text ?? "" : "")).join("").trim(),
    });
    let answer;
    try {
      // Thinking is adaptive by default on these models. If the model declines, the API re-runs the request on its
      // default fallback model inside the same call.
      answer = read(await client.beta.messages.stream({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }).finalMessage());
    } catch (e) {
      // An organization or model without the fallback beta rejects the parameter; the plain request still works.
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      answer = read(await client.messages.stream(request).finalMessage());
    }
    if (answer.refused) throw new Error("Claude declined to write this.");
    const text = answer.text;
    if (!text) throw new Error("Claude answered with nothing.");
    return text;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Anthropic did not accept the API key. Check it in Settings.");
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error("This API key may not use that model.");
    if (e instanceof Anthropic.NotFoundError) throw new Error(`Anthropic does not know the model ${model}.`);
    if (e instanceof Anthropic.RateLimitError) throw new Error("Anthropic is rate limiting this key. Try again in a minute.");
    if (e instanceof Anthropic.APIConnectionError) throw new Error("Anthropic could not be reached. Check the internet connection.");
    if (e instanceof Anthropic.APIError) throw new Error(`Anthropic answered ${e.status}: ${e.message}`);
    throw e;
  }
}

async function complete(s: AiSettings, system: string, user: string): Promise<string> {
  if (s.provider === "local") {
    if (!s.localModel) throw new Error("Choose a local model in Settings first.");
    return openAiCompatible(localBase(s.localUrl), null, s.localModel, system, user);
  }
  if (s.provider === "anthropic") {
    const key = getSecret("anthropic");
    if (!key) throw new Error("Add your Anthropic API key in Settings first.");
    return claude(key, s.anthropicModel, system, user);
  }
  if (s.provider === "openai") {
    const key = getSecret("openai");
    if (!key) throw new Error("Add your OpenAI API key in Settings first.");
    return openAiCompatible("https://api.openai.com", key, s.openaiModel, system, user);
  }
  throw new Error("Choose an AI provider in Settings first.");
}

// ---------------------------------------------------------------- what the model is given

export type JobBrief = { jobId: string; title: string; company: string; location: string; posting: string; resumeName: string | null; resume: string; applyUrl: string };

/**
 * Everything a writer needs for one job: the posting's text and the resume to start from. That is the resume in the
 * library that fits the job best; with an empty library it is the profile written out.
 */
export function jobBrief(jobId: string): JobBrief | null {
  const r = db().prepare("SELECT title, company, location, description_html, url FROM jobs WHERE id = ?").get(jobId) as Record<string, string> | undefined;
  const facts = jobScoringFacts(jobId);
  if (!r || !facts) return null;
  const best = resumeFits(facts, null)[0];
  const row = best ? (db().prepare("SELECT text FROM resumes WHERE id = ?").get(best.id) as { text: string } | undefined) : undefined;
  const p = getProfile();
  const fromProfile = [
    p.name, p.targetTitles.length ? `Target roles: ${p.targetTitles.join(", ")}` : "",
    p.years !== null ? `Years of experience: ${p.years}` : "", p.skills.length ? `Skills: ${p.skills.map(skillName).join(", ")}` : "",
  ].filter(Boolean).join("\n");
  return {
    jobId, title: r.title, company: r.company, location: r.location, applyUrl: r.url,
    posting: htmlToText(r.description_html).slice(0, 14_000),
    resumeName: best && row ? best.name : null,
    resume: (row?.text ?? fromProfile).slice(0, 14_000),
  };
}

const TRUTH = "Use only facts that are in the resume below. Never add an employer, a job title, a date, a degree, a certificate, a skill, a tool or a number that the resume does not state. You may reorder, cut and reword. If the posting asks for something the resume does not show, leave it out rather than claim it.";

const TASK: Record<DocumentKind, string> = {
  fit: "Say how well this person fits this job, in at most 180 words of plain text: the three strongest points for them, the two biggest gaps, and one thing to do before applying. Be direct. No headings, no preamble.",
  resume: `Rewrite the resume for this job. ${TRUTH} Put the experience and skills the posting cares about first and use the posting's own words where the resume supports them. Keep it to one page of plain text with simple section headings in capitals. Answer with the resume only.`,
  cover: `Write a cover letter for this job, 220 to 300 words, plain text. ${TRUTH} Open with why this role at this company, give two concrete examples from the resume, close plainly. No address block, no placeholders in brackets. Answer with the letter only.`,
  message: `Write a LinkedIn message to a recruiter or hiring manager at this company about this job. ${TRUTH} Give two versions, each on its own line and labelled: "Connection note:" (under 280 characters) and "Message:" (under 90 words). Friendly, specific, no flattery, ends with one clear ask.`,
};

export function promptFor(kind: DocumentKind, b: JobBrief): { system: string; user: string } {
  return {
    system: "You help one person with their own job search. You write plainly and you never invent facts about them.",
    user: `${TASK[kind]}\n\nJOB: ${b.title} at ${b.company}${b.location ? ` (${b.location})` : ""}\n\nPOSTING:\n${b.posting}\n\nRESUME${b.resumeName ? ` (${b.resumeName})` : ""}:\n${b.resume}`,
  };
}

/**
 * What a piece of writing claims that neither the resume nor the profile backs up: skills it names, and figures it
 * quotes. Plain word matching, shown to the person as things to check. It cannot prove a text true.
 */
export function unsupportedClaims(kind: DocumentKind, text: string, b: JobBrief): string[] {
  if (kind === "fit") return [];
  const known = new Set([...scanSkills(b.resume), ...getProfile().skills]);
  const skills = scanSkills(text).filter((s) => !known.has(s)).map(skillName);
  const source = b.resume.replace(/[,\s]/g, "");
  const figures = [...new Set(text.match(/\$?\d[\d,.]*\+?\s?(?:%|k\b|m\b|million|billion|years?|x\b)?/gi) ?? [])]
    .map((f) => f.trim()).filter((f) => /\d{2}|%/.test(f) && !/^(?:19|20)\d{2}$/.test(f) && !source.includes(f.replace(/[,\s]/g, "")));
  const out: string[] = [];
  if (skills.length) out.push(`Names ${skills.slice(0, 8).join(", ")}, which your resume does not show.`);
  if (figures.length) out.push(`Quotes ${figures.slice(0, 6).join(", ")}, which ${figures.length === 1 ? "is" : "are"} not in your resume.`);
  return out;
}

/** Writes one document for a job with the chosen provider and saves it. */
export async function writeDocument(jobId: string, kind: DocumentKind): Promise<JobDocument> {
  const brief = jobBrief(jobId);
  if (!brief) throw new Error("That job is not in the database.");
  const settings = aiSettings();
  const { system, user } = promptFor(kind, brief);
  const content = await complete(settings, system, user);
  return saveDocument({ jobId, kind, content, source: settings.provider, resumeName: brief.resumeName, warnings: unsupportedClaims(kind, content, brief) });
}

/** A short test of the chosen provider, for the Settings screen. */
export async function testProvider(): Promise<string> {
  return complete(aiSettings(), "You answer in one short sentence.", "Reply with the words: Jobhunt is connected.");
}

/** What Claude Desktop is asked to do for one job. It reads and writes through the Jobhunt connector. */
export function claudeDesktopPrompt(kind: DocumentKind, b: JobBrief): string {
  return `Use the Jobhunt connector for this. Call get_job with job_id "${b.jobId}" to read the posting for ${b.title} at ${b.company} and the resume Jobhunt recommends for it. Then: ${TASK[kind]}\n\nWhen it is written, call save_document with job_id "${b.jobId}", kind "${kind}" and the full text, so it appears on the job in Jobhunt. Then tell me in one line that the ${DOCUMENT_LABEL[kind].toLowerCase()} is saved.`;
}
