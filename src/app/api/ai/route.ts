import { aiSettings, ANTHROPIC_MODELS, localModels, saveAiSettings, testProvider, writeDocument } from "@/lib/ai";
import { connectorStatus } from "@/lib/connector";
import { isDocumentKind } from "@/lib/documents";
import { hasSecret, setSecret } from "@/lib/secrets";
import type { AiProvider } from "@/lib/types";

const PROVIDERS: AiProvider[] = ["none", "local", "anthropic", "openai", "claude-desktop"];

async function state() {
  const settings = aiSettings();
  let models: string[] = [];
  let localError: string | null = null;
  try {
    models = await localModels(settings.localUrl);
  } catch (e) {
    localError = e instanceof Error ? e.message : String(e);
  }
  // Keys are never sent to the browser: only whether one is saved.
  return {
    settings, anthropicModels: ANTHROPIC_MODELS, localModels: models, localError,
    keys: { anthropic: hasSecret("anthropic"), openai: hasSecret("openai") }, connector: connectorStatus(),
  };
}

export async function GET() {
  return Response.json(await state());
}

/** Saves the provider choice and, when given, an API key (an empty string removes it). */
export async function PUT(request: Request) {
  const b = (await request.json()) as Record<string, unknown>;
  const cur = aiSettings();
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : fallback);
  try {
    if (typeof b.localUrl === "string" && b.localUrl.trim()) new URL(b.localUrl.trim());
  } catch {
    return Response.json({ error: "The local server address is not a valid address, for example http://localhost:11434." }, { status: 400 });
  }
  saveAiSettings({
    provider: PROVIDERS.includes(b.provider as AiProvider) ? (b.provider as AiProvider) : cur.provider,
    localUrl: text(b.localUrl, cur.localUrl), localModel: typeof b.localModel === "string" ? b.localModel.trim().slice(0, 200) : cur.localModel,
    anthropicModel: text(b.anthropicModel, cur.anthropicModel), openaiModel: text(b.openaiModel, cur.openaiModel),
  });
  for (const name of ["anthropic", "openai"] as const) {
    const key = b[`${name}Key`];
    if (typeof key === "string") setSecret(name, key.trim() || null);
  }
  return Response.json(await state());
}

/** Writes one document for a job, or tests the provider ({ test: true }). */
export async function POST(request: Request) {
  const b = (await request.json()) as { jobId?: string; kind?: string; test?: boolean };
  try {
    if (b.test) return Response.json({ text: await testProvider() });
    if (!b.jobId || !isDocumentKind(b.kind)) return Response.json({ error: "jobId and kind are required." }, { status: 400 });
    return Response.json({ document: await writeDocument(b.jobId, b.kind) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
