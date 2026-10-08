import { addUpload, listResumes, removeResume, resumeFolder, scanResumeFolder, setResumeFolder } from "@/lib/resumes";
import { skillName } from "@/lib/taxonomy";

function library(extra: Record<string, unknown> = {}) {
  const resumes = listResumes();
  const skillNames = Object.fromEntries(resumes.flatMap((r) => r.skills).map((s) => [s, skillName(s)]));
  return Response.json({ resumes, skillNames, folder: resumeFolder(), ...extra });
}

/** The library. The folder is read again first, so a resume saved there a moment ago is already listed. */
export async function GET() {
  const scan = await scanResumeFolder();
  return library({ problems: scan.problems });
}

/** Adds uploaded files (form field "file", one or many). */
export async function POST(request: Request) {
  const files = (await request.formData()).getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: "Choose a PDF, Word or text file." }, { status: 400 });
  const problems: string[] = [];
  for (const f of files.slice(0, 20)) {
    try {
      await addUpload(f.name, Buffer.from(await f.arrayBuffer()));
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  return library({ problems });
}

/** Sets or clears the resume folder. */
export async function PUT(request: Request) {
  const body = (await request.json()) as { folder?: string | null };
  try {
    const scan = await setResumeFolder(body.folder ?? null);
    return library({ problems: scan.problems });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  removeResume(new URL(request.url).searchParams.get("id") ?? "");
  return library();
}
