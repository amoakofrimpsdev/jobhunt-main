import { NextResponse } from "next/server";
import { extractTextFromResume, parseResumeWithLLM } from "@/lib/resume";
import { query } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("resume");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ success: false, error: "Missing resume file." }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const rawText = await extractTextFromResume(buffer, file.name);

  if (!rawText) {
    return NextResponse.json({ success: false, error: "Unable to extract text from resume." }, { status: 400 });
  }

  const parsedResume = await parseResumeWithLLM(rawText);
  const userId = "anonymous";

  try {
    const res = await query(
      `INSERT INTO resumes (user_id, raw_text, parsed, uploaded_at)
       VALUES ($1, $2, $3, now()) RETURNING *`,
      [
        userId,
       rawText,
       parsedResume,
      ],
    );

    const data = res.rows?.[0] ?? null;
    const normalizedResume = data
      ? {
         ...data,
         parsed_skills: data.parsed?.parsed_skills ?? [],
         parsed_experience: data.parsed?.parsed_experience ?? [],
         parsed_education: data.parsed?.parsed_education ?? [],
       }
      : null;

    return NextResponse.json({ success: true, resume: normalizedResume });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
