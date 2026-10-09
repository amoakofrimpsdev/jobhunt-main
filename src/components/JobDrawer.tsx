"use client";

import { Check, ExternalLink, FileText, Minus, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ago, api, BAND, payLabel, STATUS_LABEL, WORK_LABEL } from "@/lib/client";
import { peopleSearches } from "@/lib/people";
import { LEVEL_LABEL, TRACK_STATUSES, type JobDetail, type TrackStatus } from "@/lib/types";
import { MatchRing, VisaBadges } from "./JobCard";
import { JobWriting } from "./JobWriting";

const EVIDENCE_LABEL: Record<string, string> = {
  sponsorship: "On sponsorship",
  clearanceRequired: "On clearance",
  usCitizenOnly: "On citizenship",
  eVerify: "On E-Verify",
  years: "On experience",
};

/** The job panel. Keyed by the job, so opening another job starts from a clean panel. */
export function JobDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  return id ? <Drawer key={id} id={id} onClose={onClose} onChanged={onChanged} /> : null;
}

function Drawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [applyOpened, setApplyOpened] = useState(false);

  useEffect(() => {
    let live = true;
    api<JobDetail>(`/api/job?id=${encodeURIComponent(id)}`)
      .then((j) => { if (live) { setJob(j); setNotes(j.notes); } })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  async function setStatus(status: TrackStatus | null, withNotes?: string) {
    if (!job) return;
    await api("/api/track", { method: "POST", body: JSON.stringify({ jobId: job.id, status, notes: withNotes }) });
    setJob({ ...job, status, notes: withNotes ?? job.notes });
    onChanged();
  }

  const pay = job ? payLabel(job) : null;
  const band = job?.match ? BAND[job.match.band] : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={job?.title ?? "Job"}>
      <button className="absolute inset-0 animate-fade bg-ink/30" aria-label="Close" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[680px] animate-slide flex-col bg-canvas shadow-2xl">
        <div className="flex items-center justify-between border-b border-hairline px-6 py-3">
          <span className="eyebrow text-muted">{job ? `${job.ats} board${job.department ? ` · ${job.department}` : ""}` : "Job"}</span>
          <button className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {error && <p className="p-6 text-error">{error}</p>}
        {!job && !error && (
          <div className="space-y-4 p-6">
            {[40, 24, 120, 200].map((h, i) => <div key={i} className="animate-pulse rounded-lg bg-surface-card" style={{ height: h }} />)}
          </div>
        )}

        {job && (
          <>
            <div className="flex-1 overflow-y-auto px-6 pb-8">
              <div className="flex items-start gap-4 pt-6">
                <div className="min-w-0 flex-1">
                  <h2 className="display text-[30px]">{job.title}</h2>
                  <p className="mt-2 text-[15px]">
                    <span className="font-semibold text-ink">{job.company}</span>
                    {job.location && <span className="text-muted"> · {job.location}</span>}
                  </p>
                </div>
                <MatchRing match={job.match} size={76} />
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {job.closedAt && <span className="badge badge-coral">Closed {ago(job.closedAt)}</span>}
                {job.workModel && <span className="badge">{WORK_LABEL[job.workModel]}</span>}
                {job.employmentType && <span className="badge">{job.employmentType}</span>}
                {job.level && <span className="badge">{LEVEL_LABEL[job.level]}</span>}
                {job.yearsMin !== null && <span className="badge">{job.yearsMin}+ yrs</span>}
                {pay && <span className="badge badge-ochre">{pay}</span>}
                <span className="badge">Posted {ago(job.postedAt ?? job.firstSeenAt)}</span>
                <VisaBadges job={job} />
              </div>

              {job.match && band && (
                <section className="mt-6 rounded-xl p-6" style={{ background: band.track }}>
                  <div className="flex items-baseline justify-between">
                    <h3 className="display text-[22px]">{band.label} match</h3>
                    <span className="text-[13px] font-medium text-ink/70">Why {job.match.score}%</span>
                  </div>
                  {job.match.cap && <p className="mt-2 rounded-md bg-paper/70 px-3 py-2 text-[13px] font-medium text-ink">{job.match.cap}</p>}
                  <div className="mt-4 space-y-4">
                    {job.match.parts.map((p) => (
                      <div key={p.key}>
                        <div className="flex items-center justify-between text-[13px] font-semibold text-ink">
                          <span>{p.label}</span>
                          <span>{p.score === null ? "Not scored" : `${p.score}%`}</span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper/60">
                          <div className="h-full rounded-full bg-ink transition-[width] duration-700" style={{ width: `${p.score ?? 0}%` }} />
                        </div>
                        {p.reasons.map((r) => <p key={r} className="mt-1.5 text-[13px] text-ink/75">{r}</p>)}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {job.resumes.length > 0 && (() => {
                const best = job.resumes[0];
                return (
                  <section className="mt-6 rounded-xl bg-surface-card p-6">
                    <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink"><FileText size={16} /> Which resume to send</h3>
                    {best.better ? (
                      <p className="mt-2 text-[14px]">
                        <span className="font-semibold text-ink">{best.name}</span> fits this job better than your main profile: {best.score}%{job.match ? ` against ${job.match.score}%` : ""}.
                        {best.extra.length > 0 && ` It shows ${best.extra.slice(0, 4).join(", ")}, which your profile does not list.`}
                      </p>
                    ) : (
                      <p className="mt-2 text-[14px]">None of your resumes beats your main profile on this job{job.match ? ` (${job.match.score}%)` : ""}. <span className="font-semibold text-ink">{best.name}</span> is the closest.</p>
                    )}
                    <ul className="mt-4 space-y-2">
                      {job.resumes.map((r, i) => (
                        <li key={r.id} className="flex items-center gap-3 rounded-md bg-canvas px-3 py-2">
                          <span className="w-10 text-[14px] font-semibold text-ink">{r.score}%</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium text-ink">{r.name}</span>
                            <span className="block truncate text-[12px] text-muted">{r.matched.length ? `Shows ${r.matched.slice(0, 5).join(", ")}` : "Shows none of the skills the posting names"}</span>
                          </span>
                          {i === 0 && <span className={`badge ${r.better ? "badge-mint" : ""}`}>{r.better ? "Send this one" : "Closest"}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })()}

              {job.skills.length > 0 && (
                <section className="mt-6">
                  <h3 className="eyebrow text-muted">Skills the posting names</h3>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {job.skills.map((s) => (
                      <span key={s.id} className={`badge ${s.have ? "badge-mint" : ""}`}>
                        {s.have ? <Check size={12} /> : <Minus size={12} className="text-muted-soft" />}{s.name}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {(job.blockerText || Object.keys(job.evidence).length > 0 || job.h1bFilings > 0 || job.capExempt) && (
                <section className="mt-6 rounded-xl bg-surface-card p-6">
                  <h3 className="eyebrow text-muted">Work authorization</h3>
                  <ul className="mt-3 space-y-3 text-[14px]">
                    {job.h1bFilings > 0 && (
                      <li><span className="font-semibold text-ink">{job.company}</span> had {job.h1bFilings.toLocaleString()} certified H-1B filings in recent US Department of Labor data. That is the employer&apos;s history, not a promise for this role.</li>
                    )}
                    {job.h1bFilings === 0 && <li>No recent H-1B filings were found under this employer&apos;s name.</li>}
                    {job.capExempt && <li>The name suggests a cap-exempt employer, which can sponsor H-1B all year, outside the lottery. Confirm with the employer.</li>}
                    {Object.entries(job.evidence).filter(([k]) => k !== "years").map(([k, text]) => (
                      <li key={k}>
                        <span className="font-semibold text-ink">{EVIDENCE_LABEL[k] ?? k}: </span>
                        <q className="text-body">{text}</q>
                      </li>
                    ))}
                    {job.blockerText && !Object.values(job.evidence).includes(job.blockerText) && (
                      <li><span className="font-semibold text-ink">The posting says: </span><q>{job.blockerText}</q></li>
                    )}
                  </ul>
                </section>
              )}

              <section className="mt-6 rounded-xl bg-lavender p-6 text-ink">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold"><Users size={16} /> People at {job.company}</h3>
                <p className="mt-1 text-[13px] text-ink/75">Each button opens a LinkedIn people search in your browser, signed in as you. Jobhunt reads nothing from LinkedIn.</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {peopleSearches(job).map((s) => (
                    <a key={s.key} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-md bg-canvas px-4 py-3 transition-colors hover:bg-paper">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold">{s.label}</span>
                        <span className="block truncate text-[12px] text-muted">{s.hint}</span>
                      </span>
                      <ExternalLink size={14} className="shrink-0 text-muted" />
                    </a>
                  ))}
                </div>
              </section>

              <JobWriting jobId={job.id} />

              <section className="mt-6">
                <h3 className="eyebrow text-muted">Your notes</h3>
                <textarea
                  className="field mt-3" rows={3} placeholder="Recruiter name, referral, what to mention…"
                  value={notes} onChange={(e) => setNotes(e.target.value)}
                  onBlur={() => { if (notes !== job.notes) void setStatus(job.status ?? "saved", notes); }}
                />
              </section>

              <section className="mt-8">
                <h3 className="eyebrow text-muted">The posting</h3>
                {/* description_html is rebuilt by sanitizeHtml: allowlisted tags only, with every attribute removed. */}
                <div className="posting mt-3" dangerouslySetInnerHTML={{ __html: job.descriptionHtml }} />
              </section>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-hairline bg-surface-soft px-6 py-4">
              <a className="btn btn-primary" href={job.applyUrl} target="_blank" rel="noreferrer" onClick={() => setApplyOpened(true)}>
                Apply on {job.company} <ExternalLink size={14} />
              </a>
              {applyOpened && job.status !== "applied" ? (
                <button className="btn btn-secondary" onClick={() => setStatus("applied")}><Check size={15} /> I applied</button>
              ) : (
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  Status
                  <select className="field !h-10 !w-auto" value={job.status ?? ""} onChange={(e) => setStatus((e.target.value || null) as TrackStatus | null)}>
                    <option value="">Not tracked</option>
                    {TRACK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </label>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
