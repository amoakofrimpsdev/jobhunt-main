import path from "path";
import { PDFParse } from "pdf-parse";
import { createOpenAIClient } from "./openaiClient";

export type ParsedExperience = {
  role: string;
  company: string;
  start_date?: string;
  end_date?: string;
  summary?: string;
};

export type ParsedEducation = {
  institution: string;
  degree?: string;
  years?: string;
  field?: string;
};

export type ParsedResume = {
  parsed_skills: string[];
  parsed_experience: ParsedExperience[];
  parsed_education: ParsedEducation[];
};

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

export async function extractTextFromResume(fileBuffer: Buffer, filename: string): Promise<string> {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".pdf") {
    const parser = new PDFParse({ data: fileBuffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text.trim();
  }
  return fileBuffer.toString("utf-8").trim();
}

export async function parseResumeWithLLM(text: string): Promise<ParsedResume> {
  const openai = createOpenAIClient();
  const prompt = `Parse the resume text below into strict JSON with these fields:\n\n- parsed_skills: array of skills, tools, and technologies\n- parsed_experience: array of objects with role, company, start_date, end_date, and summary\n- parsed_education: array of objects with institution, degree, years, and field\n\nReturn only a JSON object. Use empty arrays if no data is available.\n\nResume Text:\n${text}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "You are a resume parser that outputs structured JSON for skills, experience, and education.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    max_tokens: 900,
  });

  const rawText = String(completion.choices?.[0]?.message?.content ?? "");
  const result = safeJsonParse<ParsedResume>(rawText);

  if (!result) {
    throw new Error("Unable to parse resume data from OpenAI response.");
  }

  return {
    parsed_skills: Array.isArray(result.parsed_skills) ? result.parsed_skills.filter(Boolean) : [],
    parsed_experience: Array.isArray(result.parsed_experience) ? result.parsed_experience : [],
    parsed_education: Array.isArray(result.parsed_education) ? result.parsed_education : [],
  };
}
