"use client";

import Link from "next/link";
import { ArrowRight, Search, ShieldCheck, SlidersHorizontal, X, BellPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { JobCard } from "@/components/JobCard";
import { JobDrawer } from "@/components/JobDrawer";
import { api, REFRESHED_EVENT } from "@/lib/client";
import type { RefreshStatus } from "@/lib/ingest";
import type { Feed } from "@/lib/store";
import { LEVEL_LABEL, type Level, type TrackStatus, type WorkModel } from "@/lib/types";

type Filters = {
  q: string;
  work: WorkModel[];
  level: Level[];
  days: number;
  sort: "recommended" | "score" | "newest";
  // null = follow the profile.
  us: boolean | null;
  hideBlocked: boolean | null;
  h1b: boolean;
  everify: boolean;
  capExempt: boolean;
  pay: boolean;
  minScore: number;
};

const DEFAULTS: Filters = { q: "", work: [], level: [], days: 0, sort: "recommended", us: null, hideBlocked: null, h1b: false, everify: false, capExempt: false, pay: false, minScore: 0 };
const STORE_KEY = "jobhunt.filters.v1";
const PAGE = 40;

type FeedResponse = Feed & {
  applied: { usOnly: boolean; hideBlocked: boolean };
  refresh: RefreshStatus;
  profile: { ready: boolean; name: string; needsSponsorship: boolean };
};

function query(f: Filters, limit: number): string {
  const p = new URLSearchParams({ limit: String(limit), sort: f.sort });
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.work.length) p.set("work", f.work.join(","));
  if (f.level.length) p.set("level", f.level.join(","));
  if (f.days) p.set("days", String(f.days));
  if (f.us !== null) p.set("us", f.us ? "1" : "0");
  if (f.hideBlocked !== null) p.set("hideBlocked", f.hideBlocked ? "1" : "0");
  if (f.h1b) p.set("h1b", "1");
  if (f.everify) p.set("everify", "1");
  if (f.capExempt) p.set("capExempt", "1");
  if (f.pay) p.set("pay", "1");
  if (f.minScore) p.set("minScore", String(f.minScore));
  return p.toString();
}

function Toggle({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button className={`pill border ${on ? "border-ink" : "border-hairline bg-paper"}`} aria-pressed={on} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

function Stat({ value, label, className, children }: { value: string; label: string; className: string; children?: React.ReactNode }) {
  return (
    <div className={`relative overflow-hidden rounded-xl p-6 ${className}`}>
      <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/15" />
      <span className="pointer-events-none absolute -bottom-12 right-10 h-24 w-24 rounded-full bg-black/5" />
      <p className="display relative text-[44px] !text-current">{value}</p>
      <p className="relative mt-1 text-[14px] font-medium opacity-90">{label}</p>
      {children}
    </div>
  );
}

function greeting(name: string): string {
  const h = new Date().getHours();
  const hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${hello}, ${name.split(" ")[0]}.` : `${hello}.`;
}

export default function Home() {
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [moreFilters, setMoreFilters] = useState(false);
  const [alertName, setAlertName] = useState<string | null>(null);
  const [alertSaved, setAlertSaved] = useState(false);

  async function saveAlert() {
    if (alertName === null) return;
    await api("/api/alerts", { method: "POST", body: JSON.stringify({ name: alertName.trim() || filters.q.trim() || "My alert", params: query(filters, PAGE) }) });
    setAlertName(null);
    setAlertSaved(true);
    window.dispatchEvent(new Event("jobhunt:alerts-changed"));
    setTimeout(() => setAlertSaved(false), 6000);
  }
  const autoStarted = useRef(false);

  useEffect(() => {
    // Saved filters are read after the first paint, so the server and the browser render the same page first.
    const t = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Partial<Filters> | null;
        const p = new URLSearchParams(window.location.search);
        if ([...p.keys()].length) {
          // Opened from an alert: the address carries the filters.
          const list = (k: string) => (p.get(k) ?? "").split(",").filter(Boolean);
          setFilters({
            ...DEFAULTS, q: p.get("q") ?? "", work: list("work") as WorkModel[], level: list("level") as Level[], minScore: Number(p.get("minScore")) || 0,
            h1b: p.get("h1b") === "1", everify: p.get("everify") === "1", capExempt: p.get("capExempt") === "1", pay: p.get("pay") === "1",
            us: p.has("us") ? p.get("us") === "1" : null, hideBlocked: p.has("hideBlocked") ? p.get("hideBlocked") === "1" : null,
          });
          window.history.replaceState(null, "", "/");
        } else if (saved) setFilters({ ...DEFAULTS, ...saved, q: "" });
      } catch {
        // Unreadable saved filters fall back to the defaults.
      }
      setReady(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api<FeedResponse>(`/api/jobs?${query(filters, limit)}`);
      setData(d);
      setError(null);
      // The boards are read without being asked on the first run, and again when the last full read is six hours
      // old, so the feed is current whenever it is opened.
      const stale = d.refresh.lastFullAt === null ? d.openJobs === 0 || d.refresh.finishedAt === null : Date.now() - Date.parse(d.refresh.lastFullAt) > 6 * 3_600_000;
      if (stale && !d.refresh.running && !autoStarted.current) {
        autoStarted.current = true;
        await api("/api/refresh", { method: "POST", body: "{}" });
        window.dispatchEvent(new Event("jobhunt:refresh-started"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [filters, limit]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORE_KEY, JSON.stringify(filters));
    const t = setTimeout(load, filters.q ? 220 : 0);
    return () => clearTimeout(t);
  }, [ready, filters, load]);

  useEffect(() => {
    window.addEventListener(REFRESHED_EVENT, load);
    return () => window.removeEventListener(REFRESHED_EVENT, load);
  }, [load]);

  const set = (patch: Partial<Filters>) => { setLimit(PAGE); setFilters((f) => ({ ...f, ...patch })); };
  const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function onTrack(id: string, status: TrackStatus | null) {
    await api("/api/track", { method: "POST", body: JSON.stringify({ jobId: id, status }) });
    void load();
  }

  const usOnly = filters.us ?? data?.applied.usOnly ?? false;
  const hideBlocked = filters.hideBlocked ?? data?.applied.hideBlocked ?? false;
  const active = filters.work.length + filters.level.length + (filters.days ? 1 : 0) + [filters.h1b, filters.everify, filters.capExempt, filters.pay].filter(Boolean).length + (filters.minScore ? 1 : 0);
  const reading = data?.refresh.running ?? false;

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-24 sm:px-6">
      <section className="pt-12">
        <p className="eyebrow text-muted">Your job feed</p>
        <h1 className="display mt-3 text-[38px] sm:text-[56px]">{greeting(data?.profile.name ?? "")}</h1>
        <p className="mt-3 max-w-2xl text-[16px] text-body">
          {data
            ? data.openJobs > 0
              ? `${data.openJobs.toLocaleString()} open jobs from ${data.employers} employers, read straight from their own job boards. Nothing here came from an aggregator, and closed postings drop out on the next read.`
              : reading ? "Reading employer job boards for the first time. Jobs appear here as each board answers." : "No jobs yet. Press Refresh jobs to read the employer boards."
            : "Loading your feed…"}
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat value={(data?.strong ?? 0).toLocaleString()} label="Strong matches for you" className="bg-pink text-white">
            {data && !data.profile.ready && (
              <Link href="/profile" className="relative mt-3 inline-flex items-center gap-1 text-[13px] font-semibold underline">Add a profile to score jobs <ArrowRight size={13} /></Link>
            )}
          </Stat>
          <Stat value={(data?.newToday ?? 0).toLocaleString()} label="New in the last 24 hours" className="bg-lavender text-ink" />
          <Stat value={(data?.total ?? 0).toLocaleString()} label="Match your filters" className="bg-ochre text-ink" />
          <div className="relative overflow-hidden rounded-xl bg-teal p-6 text-white">
            <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-mint/20" />
            <div className="relative flex items-center gap-2 text-[13px] font-semibold text-mint"><ShieldCheck size={16} /> Sponsorship lens</div>
            <p className="relative mt-3 text-[14px] leading-snug text-white/85">
              {hideBlocked
                ? `Hiding ${(data?.blocked ?? 0).toLocaleString()} jobs that ask for citizenship or a clearance, or say they will not sponsor.`
                : `${(data?.blocked ?? 0).toLocaleString()} jobs ask for citizenship or a clearance, or say they will not sponsor.`}
            </p>
            <button className="relative mt-4 inline-flex h-8 items-center rounded-md bg-canvas px-3 text-[13px] font-semibold text-ink" onClick={() => set({ hideBlocked: !hideBlocked })}>
              {hideBlocked ? "Show them" : "Hide them"}
            </button>
          </div>
        </div>
      </section>

      <section className="top-16 z-20 -mx-4 mt-10 md:sticky border-b border-hairline bg-canvas/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-soft" />
            <input className="field !pl-11" placeholder="Search title, company or place" value={filters.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search jobs" />
          </div>
          <select className="field !w-auto" value={filters.sort} onChange={(e) => set({ sort: e.target.value as Filters["sort"] })} aria-label="Sort">
            <option value="recommended">Recommended</option>
            <option value="score">Top matched</option>
            <option value="newest">Most recent</option>
          </select>
          <button className="btn btn-secondary !h-11" onClick={() => setMoreFilters((v) => !v)} aria-expanded={moreFilters}>
            <SlidersHorizontal size={15} /> Filters{active > 0 && <span className="rounded-full bg-ink px-1.5 py-0.5 text-[11px] text-white">{active}</span>}
          </button>
          <button className="btn btn-secondary !h-11" onClick={() => setAlertName(alertName === null ? filters.q.trim() : null)} aria-expanded={alertName !== null} title="Be told when new jobs match these filters">
            <BellPlus size={15} /> Save as alert
          </button>
        </div>
        {alertName !== null && (
          <form className="mt-3 flex animate-rise flex-wrap items-center gap-2 rounded-lg bg-lavender p-4 text-ink" onSubmit={(e) => { e.preventDefault(); void saveAlert(); }}>
            <span className="text-[13px] font-semibold">Tell me when new jobs match the search and filters above. Name it:</span>
            <input className="field !h-10 max-w-xs" autoFocus value={alertName} onChange={(e) => setAlertName(e.target.value)} placeholder="Remote data analyst, H-1B filers" aria-label="Alert name" />
            <button className="btn btn-primary !h-10">Save alert</button>
            <button type="button" className="btn btn-quiet !h-10" onClick={() => setAlertName(null)}>Cancel</button>
          </form>
        )}
        {alertSaved && <p className="mt-3 text-[13px] text-ink" role="status">Alert saved. New matches show up on the <Link href="/alerts" className="font-semibold underline">Alerts</Link> page after each refresh.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Toggle on={usOnly} onClick={() => set({ us: !usOnly })}>United States</Toggle>
          <Toggle on={filters.work.includes("remote")} onClick={() => set({ work: flip(filters.work, "remote") })}>Remote</Toggle>
          <Toggle on={filters.h1b} onClick={() => set({ h1b: !filters.h1b })} title="The employer has recent certified H-1B filings and the posting names no visa limit">H-1B filer</Toggle>
          <Toggle on={filters.capExempt} onClick={() => set({ capExempt: !filters.capExempt })} title="Universities and research nonprofits, which sponsor outside the lottery">Cap-exempt</Toggle>
          <Toggle on={filters.everify} onClick={() => set({ everify: !filters.everify })} title="The posting says the employer uses E-Verify, which a STEM OPT extension needs">E-Verify</Toggle>
          <Toggle on={filters.days === 3} onClick={() => set({ days: filters.days === 3 ? 0 : 3 })}>Last 3 days</Toggle>
          <Toggle on={filters.pay} onClick={() => set({ pay: !filters.pay })}>Pay listed</Toggle>
        </div>
        {moreFilters && (
          <div className="mt-4 grid animate-rise gap-5 rounded-lg bg-surface-card p-5 md:grid-cols-4">
            <div>
              <p className="eyebrow text-muted">Work model</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(["remote", "hybrid", "onsite"] as WorkModel[]).map((w) => (
                  <Toggle key={w} on={filters.work.includes(w)} onClick={() => set({ work: flip(filters.work, w) })}>{w === "onsite" ? "On-site" : w[0].toUpperCase() + w.slice(1)}</Toggle>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <p className="eyebrow text-muted">Level</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(Object.keys(LEVEL_LABEL) as Level[]).map((l) => (
                  <Toggle key={l} on={filters.level.includes(l)} onClick={() => set({ level: flip(filters.level, l) })}>{LEVEL_LABEL[l]}</Toggle>
                ))}
              </div>
            </div>
            <div>
              <p className="eyebrow text-muted">Posted</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[[1, "24 hours"], [3, "3 days"], [7, "Week"], [30, "Month"]].map(([d, label]) => (
                  <Toggle key={d} on={filters.days === d} onClick={() => set({ days: filters.days === d ? 0 : (d as number) })}>{label}</Toggle>
                ))}
              </div>
              <p className="eyebrow mt-4 text-muted">Match at least</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[[80, "Strong"], [65, "Good"], [50, "Fair"]].map(([n, label]) => (
                  <Toggle key={n} on={filters.minScore === n} onClick={() => set({ minScore: filters.minScore === n ? 0 : (n as number) })}>{label}</Toggle>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="mt-6">
        {error && <p className="rounded-lg bg-[#ffe0dc] px-4 py-3 text-[14px] text-[#8a1f14]">{error}</p>}

        {data && !data.profile.ready && data.openJobs > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl bg-peach p-6 text-ink">
            <div className="min-w-0 flex-1">
              <h2 className="display text-[24px]">These jobs are not ranked yet.</h2>
              <p className="mt-1 text-[14px]">Upload your resume or type a target title and a few skills. Jobhunt scores every job against it on this computer, with no AI key and nothing uploaded.</p>
            </div>
            <Link href="/profile" className="btn btn-primary">Set up your profile <ArrowRight size={15} /></Link>
          </div>
        )}

        {!data && !error && (
          <div className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[124px] animate-pulse rounded-lg bg-surface-card" />)}</div>
        )}

        {data && data.jobs.length === 0 && (
          <div className="rounded-xl bg-surface-card px-8 py-16 text-center">
            <h2 className="display text-[28px]">{data.openJobs === 0 ? (reading ? "Reading the first boards…" : "No jobs yet") : "No jobs match these filters"}</h2>
            <p className="mx-auto mt-2 max-w-md text-[14px] text-muted">
              {data.openJobs === 0 ? "This takes about a minute the first time." : "Loosen a filter, or clear them all to see everything again."}
            </p>
            {data.openJobs > 0 && (
              <button className="btn btn-primary mt-6" onClick={() => set({ ...DEFAULTS, us: false, hideBlocked: false })}><X size={15} /> Clear filters</button>
            )}
          </div>
        )}

        <div className="space-y-3">
          {data?.jobs.map((job, i) => <JobCard key={job.id} job={job} index={i} onOpen={setOpen} onTrack={onTrack} />)}
        </div>

        {data && data.jobs.length < data.total && (
          <div className="mt-8 text-center">
            <button className="btn btn-secondary" onClick={() => setLimit((n) => n + PAGE)}>
              Show more · {(data.total - data.jobs.length).toLocaleString()} left
            </button>
          </div>
        )}
      </section>

      <JobDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />
    </main>
  );
}
