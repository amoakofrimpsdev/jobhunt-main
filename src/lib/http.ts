// How Jobhunt asks an employer's board for anything: a plain User-Agent, no personal data, and at most one request a
// second to any one host, however many boards are being read at once.
const USER_AGENT = "jobhunt/0.3 (personal job search; no personal data)";
const nextSlot = new Map<string, number>();

/** The board is gone (404): the employer moved, or the posting closed between the list and its page. */
export class NotFound extends Error {}

async function ask(url: string, init: RequestInit, accept: string, timeoutMs: number): Promise<Response> {
  const host = new URL(url).host;
  const at = Math.max(Date.now(), nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + 1000);
  if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
  const res = await fetch(url, {
    ...init, headers: { "User-Agent": USER_AGENT, Accept: accept, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(timeoutMs), cache: "no-store", redirect: "follow",
  });
  if (res.status === 404 || res.status === 410) throw new NotFound("The board was not found (404). The employer may have moved to another provider.");
  if (!res.ok) throw new Error(`The board answered ${res.status}.`);
  return res;
}

export async function getJson(url: string, timeoutMs = 45_000): Promise<unknown> {
  return (await ask(url, {}, "application/json", timeoutMs)).json();
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
