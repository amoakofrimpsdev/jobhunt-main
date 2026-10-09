import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDocument } from "@/lib/documents";
import { toDocx, toPdf } from "@/lib/export";
import { db, getProfile } from "@/lib/store";
import { DOCUMENT_LABEL } from "@/lib/types";

/**
 * Saves a document into the Downloads folder as a PDF, a Word file or plain text and answers where it went.
 * { reveal: path } shows a saved file in Finder. The file is written here, not downloaded by the page, so it works
 * the same in the desktop app's window as in a browser.
 */
export async function POST(request: Request) {
  const b = (await request.json()) as { id?: number; format?: string; reveal?: string };
  const downloads = join(homedir(), "Downloads");
  if (typeof b.reveal === "string") {
    if (!b.reveal.startsWith(`${downloads}/`) || b.reveal.includes("..") || !existsSync(b.reveal)) return Response.json({ error: "That file is no longer there." }, { status: 404 });
    execFile("/usr/bin/open", ["-R", b.reveal], () => undefined);
    return Response.json({ ok: true });
  }
  const doc = b.id ? getDocument(b.id) : null;
  if (!doc) return Response.json({ error: "That document no longer exists." }, { status: 404 });
  const format = b.format === "docx" || b.format === "txt" ? b.format : "pdf";
  const job = db().prepare("SELECT company FROM jobs WHERE id = ?").get(doc.jobId) as { company: string } | undefined;
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const title = [safe(getProfile().name), DOCUMENT_LABEL[doc.kind], safe(job?.company ?? "")].filter(Boolean).join(" - ");
  const bytes = format === "pdf" ? toPdf(doc.content, doc.kind, title) : format === "docx" ? toDocx(doc.content, doc.kind, title) : Buffer.from(doc.content, "utf8");
  // An earlier export of the same name is kept: the new file gets a number.
  let path = join(downloads, `${title}.${format}`);
  for (let n = 2; existsSync(path); n++) path = join(downloads, `${title} ${n}.${format}`);
  try {
    writeFileSync(path, bytes);
  } catch (e) {
    return Response.json({ error: `The file could not be saved in Downloads: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
  return Response.json({ path, name: path.slice(downloads.length + 1) });
}
