import { ResumeUploadForm } from "@/components/resume/ResumeUploadForm";

export default function ResumePage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-900">
      <div className="mx-auto max-w-4xl">
        <div className="mb-10 rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight">Upload your resume</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
            Upload a PDF or plain text version of your resume. The backend will parse it into a structured profile that can later be matched against scraped job postings.
          </p>
        </div>
        <ResumeUploadForm />
      </div>
    </main>
  );
}
