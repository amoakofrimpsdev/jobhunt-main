import { refreshStatus, startRefresh } from "@/lib/ingest";
import { detectBoard } from "@/lib/sources";
import { addBoard, directory, listBoards, removeBoard } from "@/lib/store";
import { ATS_LABEL, type Ats } from "@/lib/types";

export async function GET() {
  return Response.json({ boards: listBoards(), refresh: refreshStatus() });
}

/** Adds a board from a careers link or a directory row, and reads it straight away. */
export async function POST(request: Request) {
  const body = (await request.json()) as { url?: string; ats?: Ats; slug?: string; name?: string };
  const found = body.url ? detectBoard(body.url) : body.ats && body.slug ? { ats: body.ats, slug: body.slug } : null;
  if (!found || !(found.ats in ATS_LABEL) || found.ats === "manual") {
    return Response.json({ error: "Jobhunt could not tell which job board that link belongs to. It reads Greenhouse, Lever, Ashby, Workday, Workable, iCIMS, Oracle, JazzHR and BambooHR: paste the address of the employer's job list, for example https://jobs.lever.co/acme." }, { status: 400 });
  }
  const known = directory().find((b) => b.ats === found.ats && b.slug.toLowerCase() === found.slug.toLowerCase());
  const id = addBoard(found.ats, known?.slug ?? found.slug, body.name?.trim() || known?.name || found.slug);
  startRefresh([id]);
  return Response.json({ id, boards: listBoards(), refresh: refreshStatus() });
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return Response.json({ error: "id is required." }, { status: 400 });
  removeBoard(id);
  return Response.json({ boards: listBoards() });
}
