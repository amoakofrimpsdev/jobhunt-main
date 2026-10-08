"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

type ResumeResult = {
  parsed_skills: string[];
  parsed_experience: Array<{ role: string; company: string; start_date?: string; end_date?: string; summary?: string }>;
  parsed_education: Array<{ institution: string; degree?: string; years?: string; field?: string }>;
};

export function ResumeUploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resume, setResume] = useState<ResumeResult | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setMessage("Please choose a PDF or text resume file.");
      return;
    }

    setLoading(true);
    setMessage(null);
    setResume(null);

    const formData = new FormData();
    formData.append("resume", file);

    try {
      const response = await fetch("/api/resume/upload", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        setMessage(result.error ?? "Upload failed. Please try again.");
      } else {
        setResume(result.resume);
        setMessage("Resume parsed successfully.");
      }
    } catch (error) {
      setMessage("Unable to upload resume. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-950">Resume Upload</h1>
      <p className="mt-3 text-sm leading-7 text-slate-600">
        Upload your resume as PDF or plain text, and the app will parse it into structured skills, experience, and education.
      </p>

      <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
        <label className="block text-sm font-medium text-slate-900">
          Resume file
          <input
            type="file"
            accept=".pdf,.txt"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-3 block w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={loading}>
            {loading ? "Parsing resume..." : "Upload & parse resume"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => { setFile(null); setResume(null); setMessage(null); }}>
            Reset
          </Button>
        </div>
      </form>

      {message ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          {message}
        </div>
      ) : null}

      {resume ? (
        <div className="mt-8 space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Skills</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {resume.parsed_skills.length > 0 ? (
                resume.parsed_skills.map((skill) => (
                  <span key={skill} className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800">
                    {skill}
                  </span>
                ))
              ) : (
                <p className="text-sm text-slate-600">No skills parsed.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Experience</h2>
            <div className="mt-4 space-y-4">
              {resume.parsed_experience.length > 0 ? (
                resume.parsed_experience.map((experience, index) => (
                  <div key={`${experience.role}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">{experience.role} @ {experience.company}</p>
                    <p className="text-sm text-slate-600">{experience.start_date ?? ""}{experience.end_date ? ` — ${experience.end_date}` : ""}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{experience.summary ?? "No summary available."}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-600">No experience entries parsed.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Education</h2>
            <div className="mt-4 space-y-4">
              {resume.parsed_education.length > 0 ? (
                resume.parsed_education.map((education, index) => (
                  <div key={`${education.institution}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">{education.institution}</p>
                    <p className="text-sm text-slate-600">{education.degree ?? ""}{education.field ? ` · ${education.field}` : ""}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{education.years ?? ""}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-600">No education entries parsed.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
