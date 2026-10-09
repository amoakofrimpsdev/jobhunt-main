"use client";

import Link from "next/link";
import { ArrowRight, BellRing, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { JobCard } from "@/components/JobCard";
import { JobDrawer } from "@/components/JobDrawer";
import type { Alert, AlertHit } from "@/lib/alerts";
import { ago, api, REFRESHED_EVENT } from "@/lib/client";
import type { TrackStatus } from "@/lib/types";

type State = { alerts: Alert[]; hits: AlertHit[]; unseen: number };

export default function AlertsPage() {
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => setState(await api<State>("/api/alerts")), []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    window.addEventListener(REFRESHED_EVENT, load);
    return () => { clearTimeout(t); window.removeEventListener(REFRESHED_EVENT, load); };
  }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setState(await api<State>("/api/alerts", { method: "POST", body: JSON.stringify(body) }));
    window.dispatchEvent(new Event("jobhunt:alerts-changed"));
  };

  async function onTrack(id: string, status: TrackStatus | null) {
    await api("/api/track", { method: "POST", body: JSON.stringify({ jobId: id, status }) });
    void load();
  }

  async function remove(a: Alert) {
    if (!window.confirm(`Delete the alert “${a.name}” and its ${a.hits} matches?`)) return;
    setState(await api<State>(`/api/alerts?id=${a.id}`, { method: "DELETE" }));
    window.dispatchEvent(new Event("jobhunt:alerts-changed"));
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-24 sm:px-6">
      <section className="pt-12">
        <p className="eyebrow text-muted">Alerts</p>
        <h1 className="display mt-3 text-[38px] sm:text-[56px]">New jobs, as they land.</h1>
        <p className="mt-3 max-w-2xl text-[16px]">An alert is a search Jobhunt runs again after every refresh. Jobs that are new since the last one show up here, and on this Mac as a notification while Jobhunt is open.</p>
      </section>

      {state && state.alerts.length === 0 && (
        <div className="mt-10 rounded-xl bg-lavender px-8 py-12 text-ink">
          <BellRing size={28} />
          <h2 className="display mt-4 text-[28px]">No alerts yet</h2>
          <p className="mt-2 max-w-lg text-[14px]">On the Jobs page, set the filters you care about (a search, Remote, H-1B filer, Strong matches) and press <span className="font-semibold">Save as alert</span>.</p>
          <Link href="/" className="btn btn-primary mt-6">Go to the feed <ArrowRight size={15} /></Link>
        </div>
      )}

      {state && state.alerts.length > 0 && (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.alerts.map((a) => (
            <article key={a.id} className={`flex flex-col rounded-xl p-6 ${a.enabled ? "bg-surface-card text-ink" : "bg-surface-soft text-muted"}`}>
              <div className="flex items-start gap-3">
                <h2 className="min-w-0 flex-1 text-[16px] font-semibold leading-snug">{a.name}</h2>
                {a.unseen > 0 && <span className="badge !bg-pink !text-white">{a.unseen} new</span>}
              </div>
              <p className="mt-1 text-[13px]">{a.summary}</p>
              <p className="mt-2 text-[12px] text-muted">{a.enabled ? `Last run ${ago(a.lastRunAt)} · ${a.hits} ${a.hits === 1 ? "match" : "matches"} kept` : "Switched off"}</p>
              <div className="mt-auto flex gap-2 pt-4">
                <button className="btn btn-secondary btn-sm" onClick={() => post({ id: a.id, enabled: !a.enabled })}>{a.enabled ? "Switch off" : "Switch on"}</button>
                <Link className="btn btn-quiet btn-sm" href={`/?${a.params}`}>Open in feed</Link>
                <button className="btn btn-quiet btn-sm ml-auto" onClick={() => remove(a)} aria-label={`Delete ${a.name}`} title="Delete"><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      {state && state.alerts.length > 0 && (
        <section className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="display text-[28px]">New matches</h2>
            {state.unseen > 0 && <button className="btn btn-secondary btn-sm" onClick={() => post({ seen: true })}>Mark all {state.unseen} as read</button>}
          </div>
          {state.hits.length === 0 && <p className="mt-4 rounded-xl bg-surface-card px-6 py-8 text-[14px] text-muted">Nothing new yet. Matches appear after the next refresh that brings in a job fitting one of your alerts.</p>}
          <div className="mt-4 space-y-3">
            {state.hits.map((j, i) => (
              <div key={j.id}>
                <p className="mb-1 flex items-center gap-2 text-[12px] text-muted">
                  {!j.seen && <span className="h-2 w-2 rounded-full bg-pink" aria-label="Unread" />}
                  {j.alertName} · found {ago(j.foundAt)}
                </p>
                <JobCard job={j} index={i} onOpen={setOpen} onTrack={onTrack} />
              </div>
            ))}
          </div>
        </section>
      )}

      <JobDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />
    </main>
  );
}
