// Helpers for the screens. Nothing here may import a Node module: this file runs in the browser.
import type { Band, JobCard, TrackStatus, WorkModel } from "./types";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: init?.body && typeof init.body === "string" ? { "content-type": "application/json" } : undefined });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `The app answered ${res.status}.`);
  return body as T;
}

export const REFRESHED_EVENT = "jobhunt:refreshed";

export function ago(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86_400 * 30) return `${Math.round(s / 86_400)}d ago`;
  if (s < 86_400 * 365) return `${Math.round(s / (86_400 * 30))}mo ago`;
  return `${Math.round(s / (86_400 * 365))}y ago`;
}

const short = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

export function payLabel(j: Pick<JobCard, "payMin" | "payMax" | "payCurrency" | "payPeriod">): string | null {
  if (j.payMin === null || j.payPeriod === null) return null;
  const symbol = j.payCurrency === "USD" || !j.payCurrency ? "$" : j.payCurrency === "EUR" ? "€" : j.payCurrency === "GBP" ? "£" : `${j.payCurrency} `;
  const unit = j.payPeriod === "hour" ? "/hr" : j.payPeriod === "month" ? "/mo" : "";
  const range = j.payMax !== null && j.payMax !== j.payMin ? `${symbol}${short(j.payMin)} – ${symbol}${short(j.payMax)}` : `${symbol}${short(j.payMin)}`;
  return `${range}${unit}`;
}

export const WORK_LABEL: Record<WorkModel, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

export const BAND: Record<Band, { label: string; stroke: string; track: string }> = {
  strong: { label: "Strong", stroke: "#1a3a3a", track: "#a4d4c5" },
  good: { label: "Good", stroke: "#b98a12", track: "#f6e3ad" },
  fair: { label: "Fair", stroke: "#e07a3f", track: "#ffe1cf" },
  low: { label: "Low", stroke: "#9a9a9a", track: "#ebe6d6" },
};

export const STATUS_LABEL: Record<TrackStatus, string> = {
  saved: "Saved", applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", archived: "Archived",
};

export const BLOCKER_LABEL = { no_sponsorship: "No sponsorship", citizenship: "US citizens only", clearance: "Clearance required" } as const;
