// What has been written for a job: fit summaries, tailored resumes, cover letters and outreach messages.
import { db } from "./store";
import { DOCUMENT_KINDS, type DocumentKind, type JobDocument } from "./types";

type Row = Record<string, unknown>;

const toDocument = (r: Row): JobDocument => ({
  id: r.id as number, jobId: r.job_id as string, kind: r.kind as DocumentKind, content: r.content as string,
  source: r.source as string, resumeName: r.resume_name as string | null, warnings: JSON.parse(r.warnings as string) as string[],
  createdAt: r.created_at as string, updatedAt: r.updated_at as string,
});

export function isDocumentKind(v: unknown): v is DocumentKind {
  return DOCUMENT_KINDS.includes(v as DocumentKind);
}

export function listDocuments(jobId: string): JobDocument[] {
  return (db().prepare("SELECT * FROM documents WHERE job_id = ? ORDER BY created_at DESC, id DESC").all(jobId) as Row[]).map(toDocument);
}

export function saveDocument(d: { jobId: string; kind: DocumentKind; content: string; source: string; resumeName?: string | null; warnings?: string[] }): JobDocument {
  const now = new Date().toISOString();
  const r = db().prepare("INSERT INTO documents (job_id, kind, content, source, resume_name, warnings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(d.jobId, d.kind, d.content, d.source, d.resumeName ?? null, JSON.stringify(d.warnings ?? []), now, now);
  return toDocument(db().prepare("SELECT * FROM documents WHERE id = ?").get(Number(r.lastInsertRowid)) as Row);
}

export function editDocument(id: number, content: string): void {
  db().prepare("UPDATE documents SET content = ?, updated_at = ? WHERE id = ?").run(content, new Date().toISOString(), id);
}

export function removeDocument(id: number): void {
  db().prepare("DELETE FROM documents WHERE id = ?").run(id);
}

export function getDocument(id: number): JobDocument | null {
  const r = db().prepare("SELECT * FROM documents WHERE id = ?").get(id) as Row | undefined;
  return r ? toDocument(r) : null;
}
