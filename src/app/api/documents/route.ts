import { editDocument, listDocuments, removeDocument } from "@/lib/documents";

export async function GET(request: Request) {
  return Response.json({ documents: listDocuments(new URL(request.url).searchParams.get("jobId") ?? "") });
}

export async function PUT(request: Request) {
  const b = (await request.json()) as { id?: number; content?: string };
  if (!b.id || typeof b.content !== "string") return Response.json({ error: "id and content are required." }, { status: 400 });
  editDocument(b.id, b.content.slice(0, 40_000));
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  removeDocument(Number(new URL(request.url).searchParams.get("id")));
  return Response.json({ ok: true });
}
