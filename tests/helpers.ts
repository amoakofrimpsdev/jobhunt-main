// Shared by the test suites: a private data folder, and a fake network that answers the app's requests from
// fixtures and records every one of them, so that a test can say exactly what left the computer.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh data folder; keys kept in its file (never the Keychain); requests paced at 5 ms; no notifications. */
export function isolate(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `jobhunt-${name}-`));
  process.env.JOBHUNT_DATA_DIR = dir;
  process.env.JOBHUNT_KEYS_FILE = "1";
  process.env.JOBHUNT_PACE_MS = "5";
  process.env.JOBHUNT_QUIET = "1";
  return dir;
}

export type Call = { url: string; method: string; headers: Record<string, string>; body: string };
type Answer = Response | string | object | null;
export type Route = [RegExp, (url: string, init: RequestInit) => Answer | Promise<Answer>];

/**
 * Replaces fetch: each request is recorded and answered by the first route whose pattern matches its address.
 * A string answer is sent as text, an object as JSON, null as a 404. A request no route expects fails the way a
 * network error does, so a test sees it instead of the internet being asked.
 */
export function fakeNetwork(routes: Route[]): { calls: Call[]; restore: () => void; unexpected: string[] } {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  const unexpected: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers: Record<string, string> = {};
    new Headers(init.headers ?? {}).forEach((v, k) => { headers[k] = v; });
    calls.push({ url, method: init.method ?? "GET", headers, body: typeof init.body === "string" ? init.body : "" });
    const route = routes.find(([re]) => re.test(url));
    if (!route) { unexpected.push(url); throw new TypeError("fetch failed"); }
    const answer = await route[1](url, init);
    if (answer instanceof Response) return answer;
    if (answer === null) return new Response("not found", { status: 404 });
    if (typeof answer === "string") return new Response(answer, { status: 200, headers: { "content-type": answer.trimStart().startsWith("<") ? "text/html" : "text/plain" } });
    return Response.json(answer);
  }) as typeof fetch;
  return { calls, unexpected, restore: () => { globalThis.fetch = real; } };
}

/** Resolves once the refresh in progress has finished. */
export async function refreshDone(status: () => { running: boolean }, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (status().running) {
    if (Date.now() - start > timeoutMs) throw new Error("The refresh did not finish.");
    await new Promise((r) => setTimeout(r, 20));
  }
  // The scoring pass and alerts run just after the run is marked finished.
  await new Promise((r) => setTimeout(r, 150));
}
