"use client";

import { CircleAlert, CircleCheck, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ago, api, REFRESHED_EVENT } from "@/lib/client";
import type { DirectoryBoard } from "@/lib/store";
import type { Ats, Board, Collection } from "@/lib/types";

const ATS_LABEL: Record<Ats, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", manual: "Browser" };

export default function SourcesPage() {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [url, setUrl] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ total: number; boards: DirectoryBoard[] } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [find, setFind] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const [b, c] = await Promise.all([api<{ boards: Board[] }>("/api/boards"), api<{ collections: Collection[] }>("/api/collections")]);
    setBoards(b.boards);
    setCollections(c.collections);
  }, []);

  async function toggle(c: Collection) {
    setCollections((await api<{ collections: Collection[] }>("/api/collections", { method: "POST", body: JSON.stringify({ id: c.id, enabled: !c.enabled }) })).collections);
    void load();
  }

  useEffect(() => {
    const t = setTimeout(load, 0);
    window.addEventListener(REFRESHED_EVENT, load);
    return () => { clearTimeout(t); window.removeEventListener(REFRESHED_EVENT, load); };
  }, [load]);

  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(async () => setFound(await api(`/api/directory?q=${encodeURIComponent(q.trim())}`)), 200);
    return () => clearTimeout(t);
  }, [q, boards]);

  async function add(body: { url: string } | { ats: Ats; slug: string; name: string }, label: string) {
    try {
      const r = await api<{ boards: Board[] }>("/api/boards", { method: "POST", body: JSON.stringify(body) });
      setBoards(r.boards);
      setUrl("");
      setMessage({ ok: true, text: `${label} added. Its jobs are being read now.` });
      window.dispatchEvent(new Event("jobhunt:refresh-started"));
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function remove(b: Board) {
    if (!window.confirm(`Remove ${b.name} and its ${b.openJobs} jobs from Jobhunt? Jobs in your tracker are kept.`)) return;
    setBoards((await api<{ boards: Board[] }>(`/api/boards?id=${b.id}`, { method: "DELETE" })).boards);
  }

  async function read(b: Board) {
    await api("/api/refresh", { method: "POST", body: JSON.stringify({ boardIds: [b.id] }) });
    window.dispatchEvent(new Event("jobhunt:refresh-started"));
  }

  const shown = q.trim() ? found : null;
  const active = boards?.filter((b) => b.active) ?? [];
  const total = active.reduce((n, b) => n + b.openJobs, 0);
  const failed = active.filter((b) => b.lastOk === false);
  const needle = find.trim().toLowerCase();
  const matching = needle ? (boards ?? []).filter((b) => b.name.toLowerCase().includes(needle) || b.slug.toLowerCase().includes(needle)) : active;
  // Boards that failed come first: they are the ones that need a look.
  const ordered = [...matching].sort((a, b) => Number(b.lastOk === false) - Number(a.lastOk === false));
  const listed = showAll || needle ? ordered.slice(0, 400) : ordered.slice(0, 40);
  const colours = ["bg-pink text-white", "bg-ochre text-ink", "bg-teal text-white", "bg-lavender text-ink", "bg-peach text-ink", "bg-mint text-ink", "bg-surface-strong text-ink", "bg-coral text-white"];

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-24 sm:px-6">
      <section className="pt-12">
        <p className="eyebrow text-muted">Sources</p>
        <h1 className="display mt-3 text-[38px] sm:text-[56px]">Straight from the employer.</h1>
        <p className="mt-3 max-w-2xl text-[16px]">
          Jobhunt reads the public job feed each employer publishes through Greenhouse, Lever or Ashby: one polite request per board, at most one a second. No LinkedIn, no Indeed, no scraping of pages.
        </p>
      </section>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl bg-lavender p-8 text-ink">
          <h2 className="display text-[28px]">Add from the directory</h2>
          <p className="mt-2 text-[14px]">Search 3,500 employer boards by company name.</p>
          <input className="field mt-4" placeholder="Company name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the directory" />
          {shown && (
            <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
              {shown.boards.map((b) => (
                <li key={`${b.ats}:${b.slug}`} className="flex items-center gap-3 rounded-md bg-canvas px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{b.name}</span>
                  <span className="text-[12px] text-muted">{ATS_LABEL[b.ats]}</span>
                  <button className="btn btn-primary btn-sm" onClick={() => add({ ats: b.ats, slug: b.slug, name: b.name }, b.name)}><Plus size={14} /> Add</button>
                </li>
              ))}
              {shown.boards.length === 0 && <li className="rounded-md bg-canvas px-3 py-3 text-[13px] text-muted">No board by that name. Paste the employer&apos;s careers link instead.</li>}
              {shown.total > shown.boards.length && <li className="px-1 pt-1 text-[12px]">{shown.total - shown.boards.length} more. Keep typing to narrow it down.</li>}
            </ul>
          )}
        </section>

        <section className="rounded-xl bg-peach p-8 text-ink">
          <h2 className="display text-[28px]">Or paste a careers link</h2>
          <p className="mt-2 text-[14px]">Any address on boards.greenhouse.io, jobs.lever.co or jobs.ashbyhq.com. A link to a single job works too.</p>
          <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void add({ url: url.trim() }, "The board"); }}>
            <input className="field" placeholder="https://jobs.lever.co/acme" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Careers link" />
            <button className="btn btn-primary !h-11" disabled={!url.trim()}>Add</button>
          </form>
          {message && (
            <p className={`mt-3 rounded-md px-3 py-2 text-[13px] font-medium ${message.ok ? "bg-canvas text-ink" : "bg-[#8a1f14] text-white"}`} role="status">{message.text}</p>
          )}
        </section>
      </div>

      {collections.length > 0 && (
        <section className="mt-10">
          <h2 className="display text-[28px]">Collections</h2>
          <p className="mt-1 max-w-2xl text-[14px] text-muted">A collection is a site that lists many employers. Jobhunt follows the employers&apos; own boards behind it, so the jobs still come from the employer. Switch one off and its jobs leave the feed.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {collections.map((c, i) => {
              const missing = Object.values(c.notRead).reduce((n, v) => n + v, 0);
              return (
                <article key={c.id} className={`relative flex flex-col overflow-hidden rounded-xl p-6 ${c.enabled ? colours[i % colours.length] : "bg-surface-card text-muted"}`}>
                  <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/15" />
                  <h3 className="relative text-[16px] font-semibold leading-snug">{c.name}</h3>
                  {c.url && <p className="relative mt-0.5 truncate text-[12px] opacity-80">{c.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</p>}
                  <p className="display relative mt-4 text-[36px] !text-current">{c.openJobs.toLocaleString()}</p>
                  <p className="relative text-[13px] opacity-90">open jobs from {c.boards.toLocaleString()} boards</p>
                  {missing > 0 && (
                    <p className="relative mt-2 text-[12px] opacity-80" title={Object.entries(c.notRead).map(([k, v]) => `${k} ${v}`).join(", ")}>
                      {missing.toLocaleString()} more boards are on providers Jobhunt cannot read yet.
                    </p>
                  )}
                  <button className="relative mt-4 inline-flex h-8 w-fit items-center rounded-md bg-canvas px-3 text-[13px] font-semibold text-ink" onClick={() => toggle(c)} aria-pressed={c.enabled}>
                    {c.enabled ? "Following · switch off" : "Switch on"}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="display text-[28px]">Your boards</h2>
          <span className="text-[13px] text-muted">
            {boards ? `${active.length.toLocaleString()} boards · ${total.toLocaleString()} open jobs` : ""}
            {failed.length > 0 && <span className="text-[#8a1f14]"> · {failed.length} did not answer</span>}
          </span>
        </div>
        <input className="field mt-4 max-w-md" placeholder="Find a board you follow" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find a board you follow" />
        <div className="card mt-4 divide-y divide-hairline overflow-hidden">
          {listed.map((b) => (
            <div key={b.id} className="flex items-center gap-4 px-5 py-3">
              {b.lastOk === false ? <CircleAlert size={18} className="shrink-0 text-coral" /> : <CircleCheck size={18} className={`shrink-0 ${b.lastOk ? "text-teal" : "text-surface-strong"}`} />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink">{b.name}</p>
                <p className="truncate text-[12px] text-muted">
                  {ATS_LABEL[b.ats]} · {b.slug}
                  {b.lastOk === false && <span className="text-[#8a1f14]"> · {b.lastError}</span>}
                </p>
              </div>
              <span className="hidden w-24 text-right text-[13px] text-muted sm:block">{b.lastRunAt ? `Read ${ago(b.lastRunAt)}` : "Not read yet"}</span>
              <span className="w-20 text-right text-[14px] font-semibold text-ink">{b.openJobs.toLocaleString()}<span className="font-normal text-muted"> jobs</span></span>
              <button className="btn btn-quiet btn-sm" onClick={() => read(b)} aria-label={`Read ${b.name} again`} title="Read this board again"><RefreshCw size={15} /></button>
              <button className="btn btn-quiet btn-sm" onClick={() => remove(b)} aria-label={`Remove ${b.name}`} title="Remove"><Trash2 size={15} /></button>
            </div>
          ))}
          {!boards && <div className="h-40 animate-pulse bg-surface-card" />}
          {boards && listed.length === 0 && <p className="px-5 py-6 text-[14px] text-muted">No board you follow has that name.</p>}
        </div>
        {!needle && !showAll && ordered.length > listed.length && (
          <button className="btn btn-secondary mt-4" onClick={() => setShowAll(true)}>Show more of the {ordered.length.toLocaleString()} boards</button>
        )}
      </section>
    </main>
  );
}
