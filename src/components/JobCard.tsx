"use client";

import { Bookmark, BookmarkCheck, Check, ExternalLink, ShieldAlert, ShieldCheck } from "lucide-react";
import { ago, BAND, BLOCKER_LABEL, payLabel, WORK_LABEL } from "@/lib/client";
import { LEVEL_LABEL, type JobCard as Job, type Match, type TrackStatus } from "@/lib/types";

export function MatchRing({ match, size = 56 }: { match: Match | null; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const band = match ? BAND[match.band] : BAND.low;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={match ? `${band.label} match` : "Add a profile to score this job"}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={band.track} strokeWidth="5" />
        {match && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={band.stroke} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - match.score / 100)} className="transition-[stroke-dashoffset] duration-700" />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-semibold text-ink" style={{ fontSize: size * 0.27 }}>
        {match ? match.score : "–"}
      </span>
    </div>
  );
}

/** The work-authorization facts of a posting: what the employer's filings and the posting's own words say. */
export function VisaBadges({ job }: { job: Job }) {
  return (
    <>
      {job.blocker && (
        <span className="badge badge-coral"><ShieldAlert size={12} />{BLOCKER_LABEL[job.blocker]}</span>
      )}
      {!job.blocker && job.sponsorship === "yes" && <span className="badge badge-mint"><ShieldCheck size={12} />Says it sponsors</span>}
      {!job.blocker && job.h1bFilings > 0 && (
        <span className="badge badge-mint" title={`${job.h1bFilings.toLocaleString()} certified H-1B filings in US Department of Labor data`}>
          H-1B filer · {job.h1bFilings.toLocaleString()}
        </span>
      )}
      {job.capExempt && <span className="badge badge-lavender" title="Universities and research nonprofits can file H-1B all year, outside the lottery">Cap-exempt likely</span>}
      {job.eVerify && <span className="badge badge-mint" title="A STEM OPT extension needs an E-Verify employer">E-Verify</span>}
    </>
  );
}

export function JobCard({ job, onOpen, onTrack, index = 0 }: {
  job: Job;
  onOpen: (id: string) => void;
  onTrack: (id: string, status: TrackStatus | null) => void;
  index?: number;
}) {
  const pay = payLabel(job);
  const saved = job.status === "saved";
  return (
    <article
      className="card group flex animate-rise cursor-pointer gap-3 p-4 sm:gap-4 sm:p-5 transition-[border-color,box-shadow] hover:border-ink/25 hover:shadow-[0_6px_24px_-12px_rgb(10_10_10/0.25)]"
      style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
      onClick={() => onOpen(job.id)}
    >
      <MatchRing match={job.match} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[17px] font-semibold leading-snug text-ink">
              <button className="text-left hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(job.id); }}>{job.title}</button>
            </h3>
            <p className="mt-0.5 truncate text-[14px] text-body">
              <span className="font-medium text-ink">{job.company}</span>
              {job.location && <span className="text-muted"> · {job.location}</span>}
            </p>
          </div>
          <span className="shrink-0 pt-1 text-[12px] text-muted-soft">{ago(job.postedAt ?? job.firstSeenAt)}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {job.match && <span className="badge" style={{ background: BAND[job.match.band].track, color: "#0a0a0a" }}>{BAND[job.match.band].label} match</span>}
          {job.workModel && <span className="badge">{WORK_LABEL[job.workModel]}</span>}
          {job.level && <span className="badge">{LEVEL_LABEL[job.level]}</span>}
          {job.yearsMin !== null && <span className="badge">{job.yearsMin}+ yrs</span>}
          {pay && <span className="badge badge-ochre">{pay}</span>}
          <VisaBadges job={job} />
        </div>
        {job.match && job.match.matchedSkills.length > 0 && (
          <p className="mt-2.5 truncate text-[13px] text-muted">
            <Check size={13} className="mr-1 inline text-teal" />
            You have {job.match.matchedSkills.length} of its top skills
            {job.match.missingSkills.length > 0 && <span> · {job.match.missingSkills.length} to learn</span>}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-2" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-quiet btn-sm" aria-pressed={saved} aria-label={saved ? "Remove from saved" : "Save job"} onClick={() => onTrack(job.id, saved ? null : "saved")}>
          {saved ? <BookmarkCheck size={17} className="text-pink" /> : <Bookmark size={17} />}
        </button>
        <a className="btn btn-secondary btn-sm !hidden sm:!inline-flex" href={job.url} target="_blank" rel="noreferrer">
          Apply <ExternalLink size={13} />
        </a>
      </div>
    </article>
  );
}
