import { proposeProfile, resumeText } from "@/lib/resume";
import { skillName } from "@/lib/taxonomy";

/** Reads a resume and answers what it found. Nothing is saved until the person saves the profile. */
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a PDF or text file." }, { status: 400 });
  if (file.size > 8_000_000) return Response.json({ error: "That file is larger than 8 MB." }, { status: 400 });
  if (!/\.(pdf|txt|md)$/i.test(file.name)) return Response.json({ error: "Upload the resume as a PDF or a plain text file." }, { status: 400 });
  try {
    const text = await resumeText(Buffer.from(await file.arrayBuffer()), file.name);
    if (text.length < 80) return Response.json({ error: "No text could be read from that file. A scanned PDF is a picture; export the resume as a text PDF." }, { status: 422 });
    const proposal = proposeProfile(text);
    return Response.json({ proposal, resumeName: file.name, skillNames: Object.fromEntries(proposal.skills.map((s) => [s, skillName(s)])) });
  } catch (e) {
    return Response.json({ error: `The file could not be read: ${e instanceof Error ? e.message : String(e)}` }, { status: 422 });
  }
}
