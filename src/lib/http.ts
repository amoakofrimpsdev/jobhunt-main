// How Jobhunt asks an employer's board for anything: a plain User-Agent, no personal data, and at most one request a
// second to any one host, however many boards are being read at once.
const USER_AGENT = "jobhunt/0.3 (personal job search; no personal data)";
const nextSlot = new Map<string, number>();
/** Hosts that ask for a slower pace than one request a second. */
const PACE_MS: Record<string, number> = { "apply.careers.microsoft.com": 3000 };
/** The gap between two requests to one host, in milliseconds. JOBHUNT_PACE_MS shortens it for the tests. */
const PACE = Number(process.env.JOBHUNT_PACE_MS ?? 1000);
const scale = PACE / 1000;

/** The board is gone (404): the employer moved, or the posting closed between the list and its page. */
export class NotFound extends Error {}

/** The whole provider is down for maintenance: no board on it can be read now. */
export class Maintenance extends Error {}

async function ask(url: string, init: RequestInit, accept: string, timeoutMs: number): Promise<Response> {
  const host = new URL(url).host;
  const at = Math.max(Date.now(), nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + (PACE_MS[host] ?? 1000) * scale);
  if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
  const send = () => fetch(url, {
    ...init, headers: { "User-Agent": USER_AGENT, Accept: accept, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(timeoutMs), cache: "no-store", redirect: "follow",
  });
  // A dropped connection ("fetch failed") is often a passing thing when many boards are read at once: ask once more.
  let res = await send().catch(async (e) => {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw e;
    await new Promise((r) => setTimeout(r, 2000 * scale));
    return send();
  });
  // "Too many requests": the host wants a slower pace. Hold everything to that host back, then ask again, a few times.
  for (const wait of [10_000, 30_000, 60_000].map((w) => w * scale)) {
    if (res.status !== 429) break;
    nextSlot.set(host, Math.max(nextSlot.get(host) ?? 0, Date.now() + wait));
    await new Promise((r) => setTimeout(r, wait));
    res = await send();
  }
  // Workday and others send every request to a maintenance page during their maintenance windows.
  if (/maintenance/i.test(res.url) && res.url !== url) throw new Maintenance("The provider is down for maintenance; its boards are read again on the next refresh.");
  if (res.status === 404 || res.status === 410) throw new NotFound("The board was not found (404). The employer may have moved to another provider.");
  if (!res.ok) throw new Error(`The board answered ${res.status}.`);
  return res;
}

export async function getJson(url: string, timeoutMs = 45_000, headers: Record<string, string> = {}): Promise<unknown> {
  return (await ask(url, { headers }, "application/json", timeoutMs)).json();
}

export async function postJson(url: string, body: unknown): Promise<unknown> {
  return (await ask(url, { method: "POST", body: JSON.stringify(body) }, "application/json", 45_000)).json();
}

export async function getText(url: string, timeoutMs = 45_000): Promise<string> {
  return (await ask(url, {}, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", timeoutMs)).text();
}

export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function iso(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  if (v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
