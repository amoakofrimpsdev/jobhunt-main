"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { JobListing, JobMatch } from "@/lib/database";

type JobWithMatch = JobMatch & {
  job_listing: JobListing;
};

type FilterState = {
  location: string;
  sponsorship: string;
  citizenship: string;
  clearance: string;
  experience: string;
  score: string;
};

const SCORE_OPTIONS = [
  { label: "All scores", value: "all" },
  { label: "> 80%", value: "80" },
  { label: "> 50%", value: "50" },
  { label: "> 30%", value: "30" },
];

export function JobDashboard() {
  const [jobs, setJobs] = useState<JobWithMatch[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobWithMatch | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    location: "all",
    sponsorship: "all",
    citizenship: "all",
    clearance: "all",
    experience: "all",
    score: "all",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function fetchJobs() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/jobs");
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to load jobs.");
        }
        if (mounted) setJobs(data.jobs ?? []);
      } catch (err) {
        if (mounted) setError(String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchJobs();
    return () => { mounted = false; };
  }, []);

  async function handleAction(action: 'scrape' | 'match' | 'seed' | 'refresh') {
    setError(null);
    try {
      if (action === 'refresh') {
        setLoading(true);
        const resp = await fetch('/api/jobs');
        const data = await resp.json();
        if (!resp.ok || !data.success) throw new Error(data.error || 'Unable to refresh');
        setJobs(data.jobs ?? []);
        return;
      }

      if (action === 'seed') {
        setLoading(true);
        const resp = await fetch('/api/seed', { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok || !data.success) throw new Error(data.error || 'Seed failed');
        alert('Sample data seeded. Refreshing...');
        const r2 = await fetch('/api/jobs');
        const d2 = await r2.json();
        if (!r2.ok || !d2.success) throw new Error(d2.error || 'Unable to load jobs after seed');
        setJobs(d2.jobs ?? []);
        return;
      }

      if (action === 'scrape') {
        setLoading(true);
        const resp = await fetch('/api/scrape');
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'Scrape failed');
        alert('Scrape completed. Refreshing...');
        const r2 = await fetch('/api/jobs');
        const d2 = await r2.json();
        if (!r2.ok || !d2.success) throw new Error(d2.error || 'Unable to load jobs after scrape');
        setJobs(d2.jobs ?? []);
        return;
      }

      if (action === 'match') {
        setLoading(true);
        const resp = await fetch('/api/match/compute');
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'Match compute failed');
        alert('Match compute completed. Refreshing...');
        const r2 = await fetch('/api/jobs');
        const d2 = await r2.json();
        if (!r2.ok || !d2.success) throw new Error(d2.error || 'Unable to load jobs after match');
        setJobs(d2.jobs ?? []);
        return;
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const options = useMemo(() => {
    const locations = Array.from(new Set(jobs.map((job) => job.job_listing.location || "Unknown"))).sort();
    const experiences = Array.from(new Set(jobs.map((job) => job.job_listing.experience_level || "unknown"))).sort();
    return { locations, experiences };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const listing = job.job_listing;

      if (filters.location !== "all") {
        const normalized = listing.location || "Unknown";
        if (normalized !== filters.location) return false;
      }

      if (filters.sponsorship !== "all") {
        if (listing.sponsorship_offered !== filters.sponsorship) return false;
      }

      if (filters.citizenship !== "all") {
        const expected = filters.citizenship === "yes";
        if (listing.citizenship_required !== expected) return false;
      }

      if (filters.clearance !== "all") {
        const expected = filters.clearance === "yes";
        if (listing.clearance_required !== expected) return false;
      }

      if (filters.experience !== "all") {
        if (listing.experience_level !== filters.experience) return false;
      }

      if (filters.score !== "all") {
        const minimum = Number(filters.score);
        if ((job.score ?? 0) <= minimum) return false;
      }

      return true;
    });
  }, [jobs, filters]);

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Dashboard</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Matched job listings</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Filter the AI-matched jobs by location, experience, sponsorship, citizenship, clearance, and score.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" size="sm" onClick={() => setFilters({ location: "all", sponsorship: "all", citizenship: "all", clearance: "all", experience: "all", score: "all" })}>
              Clear filters
            </Button>

            <Button variant="default" size="sm" onClick={() => handleAction('refresh')}>
              Refresh
            </Button>

            <Button variant="outline" size="sm" onClick={() => handleAction('seed')}>Seed sample data</Button>

            <Button variant="default" size="sm" onClick={() => handleAction('scrape')}>Run scrape</Button>

            <Button variant="default" size="sm" onClick={() => handleAction('match')}>Compute matches</Button>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Total matched jobs</p>
            <p className="text-3xl font-semibold text-slate-900">{jobs.length}</p>
          </div>
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Visible after filters</p>
            <p className="text-3xl font-semibold text-slate-900">{filteredJobs.length}</p>
          </div>
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Current score cut</p>
            <p className="text-3xl font-semibold text-slate-900">{filters.score === "all" ? "Any" : `${filters.score}%+`}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Filters</p>
          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Location</label>
              <select value={filters.location} onChange={(event) => handleFilterChange("location", event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200">
                <option value="all">All locations</option>
                {options.locations.map((location) => (
                  <option key={location} value={location}>{location}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Sponsorship</label>
              <select value={filters.sponsorship} onChange={(event) => handleFilterChange("sponsorship", event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200">
                <option value="all">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Citizenship required</label>
              <select value={filters.citizenship} onChange={(event) => handleFilterChange("citizenship", event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200">
                <option value="all">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Clearance required</label>
              <select value={filters.clearance} onChange={(event) => handleFilterChange("clearance", event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200">
                <option value="all">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Experience level</label>
              <select value={filters.experience} onChange={(event) => handleFilterChange("experience", event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200">
                <option value="all">All</option>
                {options.experiences.map((experience) => (
                  <option key={experience} value={experience}>{experience}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Match score</label>
              <select value={filters.score} onChange={(event) => handleFilterChange("score", event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200">
                {SCORE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
        </aside>

        <div className="space-y-6">
          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-700 shadow-sm">Loading matched jobs...</div>
          ) : error ? (
            <div className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-rose-900 shadow-sm">{error}</div>
          ) : filteredJobs.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-700 shadow-sm">No matched jobs found with the current filters.</div>
          ) : (
            <div className="grid gap-4">
              {filteredJobs.map((job) => (
                <article key={job.id} className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow-md">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                        <span>{job.job_listing.company}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs uppercase tracking-[0.24em] text-slate-600">{job.job_listing.experience_level}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs uppercase tracking-[0.24em] text-slate-600">{job.job_listing.sponsorship_offered}</span>
                      </div>
                      <h2 className="text-xl font-semibold text-slate-900">{job.job_listing.title}</h2>
                      <p className="text-sm leading-6 text-slate-600">
                        {job.job_listing.location ?? "Location not specified"}
                        {job.job_listing.date_posted ? ` · Posted ${job.job_listing.date_posted}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-3 sm:items-end">
                      <span className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">{job.score}% match</span>
                      <Button variant="outline" size="sm" onClick={() => setSelectedJob(job)}>
                        View details
                      </Button>
                    </div>
                  </div>

                  <p className="mt-5 text-sm leading-6 text-slate-700 max-h-24 overflow-hidden text-ellipsis">{job.job_listing.description}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {selectedJob ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-full w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-8 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-500">{selectedJob.job_listing.company}</p>
                <h2 className="mt-2 text-3xl font-semibold text-slate-950">{selectedJob.job_listing.title}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">{selectedJob.job_listing.location ?? "Location not specified"}</p>
              </div>
              <button className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100" onClick={() => setSelectedJob(null)}>
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                  <h3 className="text-lg font-semibold text-slate-900">Job description</h3>
                  <p className="mt-4 text-sm leading-7 text-slate-700 whitespace-pre-wrap">{selectedJob.job_listing.description}</p>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                  <h3 className="text-lg font-semibold text-slate-900">Requirements</h3>
                  <p className="mt-4 text-sm leading-7 text-slate-700 whitespace-pre-wrap">{selectedJob.job_listing.requirements}</p>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                  <h3 className="text-lg font-semibold text-slate-900">Match summary</h3>
                  <p className="mt-4 text-sm leading-7 text-slate-700 whitespace-pre-wrap">{selectedJob.summary}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                  <h3 className="text-lg font-semibold text-slate-900">Job details</h3>
                  <div className="mt-4 space-y-3 text-sm text-slate-700">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">Experience level</span>
                      <span>{selectedJob.job_listing.experience_level}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">Sponsorship</span>
                      <span>{selectedJob.job_listing.sponsorship_offered}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">Citizenship required</span>
                      <span>{selectedJob.job_listing.citizenship_required ? "Yes" : "No"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">Clearance required</span>
                      <span>{selectedJob.job_listing.clearance_required ? "Yes" : "No"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">Match score</span>
                      <span>{selectedJob.score}%</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                  <h3 className="text-lg font-semibold text-slate-900">Apply</h3>
                  <a href={selectedJob.job_listing.application_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                    Open application link
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
