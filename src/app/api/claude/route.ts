import { execFile } from "node:child_process";
import { jobBrief } from "@/lib/ai";
import { claudeDesktopPrompt, connectorStatus, installConnector } from "@/lib/connector";
import { isDocumentKind } from "@/lib/documents";

export async function GET() {
  return Response.json(connectorStatus());
}

/**
 * { install: true } adds the connector to Claude Desktop's config. { jobId, kind } hands one piece of writing to
 * Claude Desktop: it opens Claude with the request filled in and answers the same text, which the screen also copies
 * so it can be pasted if Claude opens without it.
 */
export async function POST(request: Request) {
  const b = (await request.json()) as { install?: boolean; jobId?: string; kind?: string };
  try {
    if (b.install) return Response.json(installConnector());
    const brief = b.jobId ? jobBrief(b.jobId) : null;
    if (!brief || !isDocumentKind(b.kind)) return Response.json({ error: "That job is not in the database." }, { status: 404 });
    const prompt = claudeDesktopPrompt(b.kind, brief);
    const opened = await new Promise<boolean>((resolve) => {
      execFile("/usr/bin/open", [`claude://claude.ai/new?q=${encodeURIComponent(prompt)}`], (error) => resolve(!error));
    });
    return Response.json({ prompt, opened, at: Date.now() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
