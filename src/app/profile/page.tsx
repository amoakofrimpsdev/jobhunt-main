"use client";

import Link from "next/link";
import { ArrowRight, Check, FileUp, FolderOpen, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { EMPTY_PROFILE, LEVEL_LABEL, LEVELS, type Level, type Profile, type Resume } from "@/lib/types";

type ProfileResponse = { profile: Profile; skillNames: Record<string, string>; scored?: number };
type Library = { resumes: Resume[]; skillNames: Record<string, string>; folder: string | null; problems?: string[] };

function Tags({ values, label, onRemove }: { values: string[]; label: (v: string) => string; onRemove: (v: string) => void }) {
  if (!values.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {values.map((v) => (
        <span key={v} className="badge !h-7 !pr-1.5">
          {label(v)}
          <button className="rounded-full p-0.5 hover:bg-surface-strong" onClick={() => onRemove(v)} aria-label={`Remove ${label(v)}`}><X size={12} /></button>
        </span>
      ))}
    </div>
  );
}

function Switch({ on, onChange, title, children }: { on: boolean; onChange: (v: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-4 rounded-lg border border-hairline bg-paper p-4">
      <button type="button" role="switch" aria-checked={on} aria-label={title} onClick={() => onChange(!on)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-ink" : "bg-surface-strong"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
      <span>
        <span className="block text-[14px] font-semibold text-ink">{title}</span>
        <span className="block text-[13px] text-muted">{children}</span>
      </span>
    </label>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [skill, setSkill] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState<"resume" | "save" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string; scored?: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState<Library>({ resumes: [], skillNames: {}, folder: null });
  const [folder, setFolder] = useState("");

  function showLibrary(l: Library) {
    setLibrary(l);
    setNames((n) => ({ ...n, ...l.skillNames }));
    setFolder(l.folder ?? "");
    if (l.problems?.length) setNote({ ok: false, text: l.problems.join(" ") });
  }

  useEffect(() => {
    void api<ProfileResponse>("/api/profile").then((r) => { setProfile(r.profile); setNames((n) => ({ ...n, ...r.skillNames })); setLoaded(true); });
    void api<Library>("/api/resumes").then(showLibrary);
  }, []);

  useEffect(() => {
    if (!skill.trim()) return;
    const t = setTimeout(async () => setHits((await api<{ skills: Array<{ id: string; name: string }> }>(`/api/skills?q=${encodeURIComponent(skill.trim())}`)).skills), 120);
    return () => clearTimeout(t);
  }, [skill]);

  const shownHits = skill.trim() ? hits : [];
  const patch = (p: Partial<Profile>) => { setProfile((old) => ({ ...old, ...p })); setDirty(true); setNote(null); };

  function addTitle() {
    const t = title.trim();
    if (t && !profile.targetTitles.some((x) => x.toLowerCase() === t.toLowerCase())) patch({ targetTitles: [...profile.targetTitles, t] });
    setTitle("");
  }

  function addSkill(s: { id: string; name: string }) {
    setNames((n) => ({ ...n, [s.id]: s.name }));
    if (!profile.skills.includes(s.id)) patch({ skills: [...profile.skills, s.id] });
    setSkill("");
    setHits([]);
  }

  async function addResumes(files: File[]) {
    if (!files.length) return;
    setBusy("resume");
    setNote(null);
    try {
      const form = new FormData();
      for (const f of files) form.append("file", f);
      const before = new Set(library.resumes.map((r) => r.id));
      const l = await api<Library>("/api/resumes", { method: "POST", body: form });
      showLibrary(l);
      const added = l.resumes.filter((r) => !before.has(r.id));
      // An empty profile is filled from the first resume added, for the person to check and save.
      if (added[0] && !profile.targetTitles.length && !profile.skills.length) fillProfileFrom(added[0]);
      else if (added.length && !l.problems?.length) setNote({ ok: true, text: `${added.length === 1 ? added[0].name : `${added.length} resumes`} added. Open any job to see which resume fits it best.` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  /** Adds what a resume says to the form. It never removes something the person typed. */
  function fillProfileFrom(r: Resume) {
    setProfile((old) => ({
      ...old,
      targetTitles: [...new Set([...old.targetTitles, ...r.titles])],
      skills: [...new Set([...old.skills, ...r.skills])],
      years: old.years ?? r.years,
      resumeName: r.name,
    }));
    setDirty(true);
    setNote({ ok: true, text: `Added ${r.skills.length} skills and ${r.titles.length} titles from ${r.name}. Check them, then save.` });
  }

  async function removeResume(r: Resume) {
    showLibrary(await api<Library>(`/api/resumes?id=${encodeURIComponent(r.id)}`, { method: "DELETE" }));
  }

  async function saveFolder(value: string | null) {
    setBusy("resume");
    try {
      const l = await api<Library>("/api/resumes", { method: "PUT", body: JSON.stringify({ folder: value }) });
      showLibrary(l);
      if (!l.problems?.length) setNote({ ok: true, text: value ? `Watching ${l.folder}: ${l.resumes.filter((r) => r.source === "folder").length} resumes found.` : "The folder is no longer watched." });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const r = await api<ProfileResponse>("/api/profile", { method: "PUT", body: JSON.stringify(profile) });
      setProfile(r.profile);
      setNames(r.skillNames);
      setDirty(false);
      setNote({ ok: true, text: `Saved. ${(r.scored ?? 0).toLocaleString()} open jobs scored against your profile.`, scored: r.scored });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-24 sm:px-6">
      <section className="pt-12">
        <p className="eyebrow text-muted">Profile</p>
        <h1 className="display mt-3 text-[38px] sm:text-[56px]">What are you looking for?</h1>
        <p className="mt-3 max-w-2xl text-[16px]">Every job is scored against this page: the role, the skills and the level. It stays in a file on this computer.</p>
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className={`space-y-8 ${loaded ? "" : "pointer-events-none opacity-50"}`}>
          <section>
            <label className="eyebrow text-muted" htmlFor="name">Your name</label>
            <input id="name" className="field mt-3 max-w-md" value={profile.name} onChange={(e) => patch({ name: e.target.value })} placeholder="First and last name" />
          </section>

          <section>
            <label className="eyebrow text-muted" htmlFor="title">Target job titles</label>
            <p className="mt-1 text-[13px] text-muted">The jobs you want, as employers write them. This drives the role score more than anything else.</p>
            <form className="mt-3 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); addTitle(); }}>
              <input id="title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Data Analyst" />
              <button className="btn btn-secondary !h-11" disabled={!title.trim()}>Add</button>
            </form>
            <Tags values={profile.targetTitles} label={(v) => v} onRemove={(v) => patch({ targetTitles: profile.targetTitles.filter((x) => x !== v) })} />
          </section>

          <section>
            <label className="eyebrow text-muted" htmlFor="skill">Skills</label>
            <p className="mt-1 text-[13px] text-muted">Tools, languages and methods you can show. Pick from the list so a posting&apos;s wording still matches.</p>
            <div className="relative mt-3 max-w-md">
              <input id="skill" className="field" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="Type a skill, for example SQL"
                onKeyDown={(e) => { if (e.key === "Enter" && shownHits[0]) { e.preventDefault(); addSkill(shownHits[0]); } }} autoComplete="off" />
              {shownHits.length > 0 && (
                <ul className="card absolute left-0 right-0 top-12 z-10 overflow-hidden shadow-lg">
                  {shownHits.map((h) => (
                    <li key={h.id}><button className="block w-full px-4 py-2 text-left text-[14px] text-ink hover:bg-surface-soft" onClick={() => addSkill(h)}>{h.name}</button></li>
                  ))}
                </ul>
              )}
              {skill.trim().length > 1 && shownHits.length === 0 && <p className="mt-2 text-[12px] text-muted">No skill by that name in the list yet.</p>}
            </div>
            <Tags values={profile.skills} label={(v) => names[v] ?? v} onRemove={(v) => patch({ skills: profile.skills.filter((x) => x !== v) })} />
          </section>

          <section className="grid max-w-md grid-cols-2 gap-4">
            <div>
              <label className="eyebrow text-muted" htmlFor="years">Years of experience</label>
              <input id="years" type="number" min={0} max={60} className="field mt-3" value={profile.years ?? ""} placeholder="2"
                onChange={(e) => patch({ years: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>
            <div>
              <label className="eyebrow text-muted" htmlFor="level">Level</label>
              <select id="level" className="field mt-3" value={profile.level ?? ""} onChange={(e) => patch({ level: (e.target.value || null) as Level | null })}>
                <option value="">From my years</option>
                {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
              </select>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            <Switch on={profile.needsSponsorship} onChange={(v) => patch({ needsSponsorship: v })} title="I need visa sponsorship">
              On F-1 OPT, H-1B or similar. Jobs that ask for citizenship or a clearance, or say they will not sponsor, are held at 20% and hidden by default.
            </Switch>
            <Switch on={profile.usOnly} onChange={(v) => patch({ usOnly: v })} title="United States jobs only">
              Leaves out jobs whose every location is in another country. A bare “Remote” stays in.
            </Switch>
          </section>

          <div className="flex flex-wrap items-center gap-4">
            <button className="btn btn-primary" onClick={save} disabled={busy !== null || !dirty}>
              {busy === "save" ? "Scoring jobs…" : dirty ? "Save and score jobs" : <><Check size={15} /> Saved</>}
            </button>
            {note && (
              <p className={`text-[14px] ${note.ok ? "text-ink" : "text-[#8a1f14]"}`} role="status">
                {note.text}{" "}
                {note.scored !== undefined && <Link href="/" className="inline-flex items-center gap-1 font-semibold underline">See your feed <ArrowRight size={13} /></Link>}
              </p>
            )}
          </div>
        </div>

        <aside className="order-first space-y-4 lg:order-none">
          <section
            className="rounded-xl bg-teal p-8 text-white"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void addResumes([...e.dataTransfer.files]); }}
          >
            <FileUp size={28} className="text-mint" />
            <h2 className="display mt-4 text-[28px] !text-white">Your resumes</h2>
            <p className="mt-2 text-[14px] text-white/80">Add every version you use. Each job shows which one fits it best. PDF, Word or text, read on this computer by plain rules: no AI, no upload.</p>
            <input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md" multiple className="hidden" onChange={(e) => { void addResumes([...(e.target.files ?? [])]); e.target.value = ""; }} />
            <button className="mt-5 inline-flex h-10 items-center rounded-md bg-canvas px-4 text-[14px] font-semibold text-ink" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
              {busy === "resume" ? "Reading…" : "Add resumes"}
            </button>

            {library.resumes.length > 0 && (
              <ul className="mt-5 space-y-2">
                {library.resumes.map((r) => (
                  <li key={r.id} className="rounded-md bg-canvas p-3 text-ink">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold" title={r.name}>{r.name}</p>
                        <p className="truncate text-[12px] text-muted">
                          {r.source === "folder" ? "From your folder · " : ""}{r.skills.length} skills{r.titles[0] ? ` · ${r.titles[0]}` : ""}
                        </p>
                      </div>
                      <button className="btn btn-quiet btn-sm !px-2" onClick={() => removeResume(r)} aria-label={`Remove ${r.name}`} title={r.source === "folder" ? "Hide from Jobhunt (the file stays in your folder)" : "Remove"}><Trash2 size={14} /></button>
                    </div>
                    <button className="mt-1 text-[12px] font-semibold underline" onClick={() => fillProfileFrom(r)}>Add its skills and titles to my profile</button>
                  </li>
                ))}
              </ul>
            )}

            <form className="mt-6 border-t border-white/15 pt-5" onSubmit={(e) => { e.preventDefault(); void saveFolder(folder.trim() || null); }}>
              <label className="flex items-center gap-2 text-[13px] font-semibold text-mint" htmlFor="folder"><FolderOpen size={15} /> Or watch a folder</label>
              <p className="mt-1 text-[12px] text-white/70">Resumes saved in it show up here by themselves. Jobhunt only reads them.</p>
              <div className="mt-3 flex gap-2">
                <input id="folder" className="field !h-10" placeholder="~/Documents/Resumes" value={folder} onChange={(e) => setFolder(e.target.value)} />
                <button className="inline-flex h-10 shrink-0 items-center rounded-md bg-canvas px-3 text-[13px] font-semibold text-ink disabled:opacity-60" disabled={busy !== null || folder.trim() === (library.folder ?? "")}>
                  {folder.trim() || !library.folder ? "Watch" : "Stop"}
                </button>
              </div>
            </form>
          </section>
          <section className="rounded-xl bg-surface-card p-8">
            <h2 className="eyebrow text-muted">How the score works</h2>
            <ul className="mt-3 space-y-2.5 text-[14px]">
              <li><span className="font-semibold text-ink">Role, 45%.</span> How close the title is to one of your targets.</li>
              <li><span className="font-semibold text-ink">Skills, 35%.</span> How many of the skills the posting names most you have.</li>
              <li><span className="font-semibold text-ink">Level, 20%.</span> The years and seniority it asks for against yours.</li>
            </ul>
            <p className="mt-3 text-[13px] text-muted">The same profile and posting always give the same number, and every job shows its reasons.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
