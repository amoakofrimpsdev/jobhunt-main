"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MatchRing } from "@/components/JobCard";
import { JobDrawer } from "@/components/JobDrawer";
import { ago, api, STATUS_LABEL } from "@/lib/client";
import type { Tracked } from "@/lib/store";
import { TRACK_STATUSES, type TrackStatus } from "@/lib/types";

const COLUMNS: Array<{ status: TrackStatus; className: string; hint: string }> = [
  { status: "saved", className: "bg-lavender text-ink", hint: "Jobs you bookmarked" },
  { status: "applied", className: "bg-ochre text-ink", hint: "Sent, waiting to hear" },
  { status: "interviewing", className: "bg-peach text-ink", hint: "In conversation" },
  { status: "offer", className: "bg-teal text-white", hint: "They said yes" },
  { status: "rejected", className: "bg-surface-strong text-ink", hint: "Closed out" },
];

export default function TrackerPage() {
  const [jobs, setJobs] = useState<Tracked[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setJobs((await api<{ jobs: Tracked[] }>("/api/track")).jobs);
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function move(id: string, status: TrackStatus | null) {
    await api("/api/track", { method: "POST", body: JSON.stringify({ jobId: id, status }) });
    void load();
  }

  const shown = jobs?.filter((j) => j.status !== "archived") ?? [];
  const archived = jobs?.filter((j) => j.status === "archived").length ?? 0;

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-24 sm:px-6">
      <section className="pt-12">
        <p className="eyebrow text-muted">Tracker</p>
        <h1 className="display mt-3 text-[38px] sm:text-[56px]">Every application, one board.</h1>
        <p className="mt-3 max-w-2xl text-[16px]">Save a job from the feed and move it along as things happen. A posting that closes stays here with its notes.</p>
      </section>

      {jobs && jobs.length === 0 && (
        <div className="mt-10 rounded-xl bg-surface-card px-8 py-16 text-center">
          <h2 className="display text-[28px]">Nothing tracked yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-muted">Bookmark a job in the feed, or press “I applied” after you open its application.</p>
          <Link href="/" className="btn btn-primary mt-6">Go to the feed <ArrowRight size={15} /></Link>
        </div>
      )}

      {jobs && jobs.length > 0 && (
        <div className="mt-10 grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map((col) => {
            const items = shown.filter((j) => j.status === col.status);
            return (
              <section key={col.status} className="min-w-0">
                <header className={`rounded-xl px-5 py-4 ${col.className}`}>
                  <div className="flex items-baseline justify-between">
                    <h2 className="display text-[22px] !text-current">{STATUS_LABEL[col.status]}</h2>
                    <span className="text-[14px] font-semibold">{items.length}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] opacity-80">{col.hint}</p>
                </header>
                <div className="mt-3 space-y-3">
                  {items.map((j) => (
                    <article key={j.id} className="card animate-rise cursor-pointer p-4 hover:border-ink/25" onClick={() => setOpen(j.id)}>
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[14px] font-semibold leading-snug text-ink">{j.title}</h3>
                          <p className="mt-0.5 truncate text-[13px] text-muted">{j.company}</p>
                        </div>
                        <MatchRing match={j.match} size={40} />
                      </div>
                      {j.closedAt && <span className="badge badge-coral mt-2">Posting closed</span>}
                      {j.notes && <p className="mt-2 line-clamp-2 text-[13px] text-body">{j.notes}</p>}
                      <div className="mt-3 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[12px] text-muted-soft">{ago(j.updatedAt)}</span>
                        <select
                          className="h-8 rounded-sm border border-hairline bg-paper px-2 text-[12px] font-medium text-ink"
                          value={j.status ?? ""} aria-label={`Status of ${j.title}`}
                          onChange={(e) => move(j.id, (e.target.value || null) as TrackStatus | null)}
                        >
                          {TRACK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                          <option value="">Remove</option>
                        </select>
                      </div>
                    </article>
                  ))}
                  {items.length === 0 && <p className="rounded-lg border border-dashed border-surface-strong px-4 py-6 text-center text-[13px] text-muted-soft">Empty</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {archived > 0 && <p className="mt-6 text-[13px] text-muted">{archived} archived {archived === 1 ? "job is" : "jobs are"} hidden.</p>}

      <JobDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />
    </main>
  );
}
