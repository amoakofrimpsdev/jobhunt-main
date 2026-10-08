import { runTool } from "@/lib/connector";
import { connectorTokenOk } from "@/lib/runfile";

/** One connector tool call from the Claude Desktop connector, which reads this launch's token from run.json. */
export async function POST(request: Request) {
  if (!connectorTokenOk(request.headers.get("x-jobhunt-token"))) return Response.json({ error: "Not allowed." }, { status: 403 });
  const body = (await request.json()) as { tool?: string; args?: Record<string, unknown> };
  try {
    return Response.json({ text: runTool(body.tool ?? "", body.args ?? {}) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
