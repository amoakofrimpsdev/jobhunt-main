"use client";

import Link from "next/link";
import { Copy, Download, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ago, api } from "@/lib/client";
import { DOCUMENT_KINDS, DOCUMENT_LABEL, type AiProvider, type DocumentKind, type JobDocument } from "@/lib/types";

const SOURCE_LABEL: Record<string, string> = { local: "local model", anthropic: "Claude API", openai: "OpenAI", "claude-desktop": "Claude Desktop" };
const BUTTON: Record<DocumentKind, string> = { fit: "Explain my fit", resume: "Tailor resume", cover: "Cover letter", message: "Outreach message" };

/** The AI writing for one job: the four actions, and everything written so far, editable. */
export function JobWriting({ jobId, company }: { jobId: string; company: string }) {
  const [provider, setProvider] = useState<AiProvider | null>(null);
  const [docs, setDocs] = useState<JobDocument[]>([]);
  const [busy, setBusy] = useState<DocumentKind | null>(null);
  const [waiting, setWaiting] = useState<{ kind: DocumentKind; prompt: string; opened: boolean; since: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | "prompt" | null>(null);
  const count = useRef(0);

  const load = useCallback(async () => {
    const d = (await api<{ documents: JobDocument[] }>(`/api/documents?jobId=${encodeURIComponent(jobId)}`)).documents;
    setDocs(d);
    return d;
  }, [jobId]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load().then((d) => { count.current = d.length; });
      void api<{ settings: { provider: AiProvider } }>("/api/ai").then((r) => setProvider(r.settings.provider));
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // While Claude Desktop is writing, look for the document it saves back.
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(async () => {
      const d = await load();
      if (d.length > count.current) { count.current = d.length; setWaiting(null); }
      else if (Date.now() - waiting.since > 15 * 60_000) setWaiting(null);
    }, 3000);
    return () => clearInterval(id);
  }, [waiting, load]);

  async function copy(text: string, mark: number | "prompt") {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(mark);
    setTimeout(() => setCopied(null), 1500);
  }

  async function write(kind: DocumentKind) {
    setError(null);
    setBusy(kind);
    try {
      if (provider === "claude-desktop") {
        const r = await api<{ prompt: string; opened: boolean; at: number }>("/api/claude", { method: "POST", body: JSON.stringify({ jobId, kind }) });
        await navigator.clipboard.writeText(r.prompt).catch(() => undefined);
        setWaiting({ kind, prompt: r.prompt, opened: r.opened, since: r.at });
      } else {
        await api("/api/ai", { method: "POST", body: JSON.stringify({ jobId, kind }) });
        count.current = (await load()).length;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function download(d: JobDocument) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([d.content], { type: "text/plain" }));
    a.download = `${DOCUMENT_LABEL[d.kind]} - ${company}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function remove(d: JobDocument) {
    await api(`/api/documents?id=${d.id}`, { method: "DELETE" });
    count.current = (await load()).length;
  }

  return (
    <section className="mt-6 rounded-xl bg-peach p-6 text-ink">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles size={16} /> Write with AI</h3>
      {provider === "none" ? (
        <p className="mt-2 text-[14px]">
          Off. Choose a model on this computer, your own API key or Claude Desktop in{" "}
          <Link href="/settings" className="font-semibold underline">Settings</Link>, and Jobhunt can explain your fit, tailor a resume, and draft a cover letter or a message for this job.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-ink/75">
            {provider === "claude-desktop"
              ? "Opens Claude Desktop with the request. Claude reads the job through the Jobhunt connector and saves the result back here."
              : `Written by your ${SOURCE_LABEL[provider ?? ""] ?? "model"} from the resume that fits this job best, using only what that resume says.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {DOCUMENT_KINDS.map((k) => (
              <button key={k} className="btn btn-primary btn-sm" disabled={busy !== null || provider === null} onClick={() => write(k)}>
                {busy === k ? "Writing…" : BUTTON[k]}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="mt-3 rounded-md bg-[#8a1f14] px-3 py-2 text-[13px] font-medium text-white" role="alert">{error}</p>}

      {waiting && (
        <div className="mt-4 rounded-md bg-canvas p-4 text-[13px]" role="status">
          <p className="font-semibold">Waiting for Claude Desktop to save the {DOCUMENT_LABEL[waiting.kind].toLowerCase()}…</p>
          <p className="mt-1 text-muted">
            {waiting.opened ? "Claude should be open with the request filled in: press Enter there." : "Claude Desktop did not open by itself. Open it and start a new chat."}{" "}
            The request is also on your clipboard, so you can paste it if the chat is empty.
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => copy(waiting.prompt, "prompt")}><Copy size={13} /> {copied === "prompt" ? "Copied" : "Copy the request again"}</button>
            <button className="btn btn-quiet btn-sm" onClick={() => setWaiting(null)}>Stop waiting</button>
          </div>
        </div>
      )}

      {docs.map((d) => (
        <article key={d.id} className="mt-4 rounded-md bg-canvas p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{DOCUMENT_LABEL[d.kind]}</span>
            <span className="text-[12px] text-muted">
              {SOURCE_LABEL[d.source] ?? d.source}{d.resumeName ? ` · from ${d.resumeName}` : ""} · {ago(d.createdAt)}
            </span>
            <span className="ml-auto flex gap-1">
              <button className="btn btn-quiet btn-sm !px-2" onClick={() => copy(d.content, d.id)} title="Copy" aria-label="Copy">{copied === d.id ? "Copied" : <Copy size={14} />}</button>
              <button className="btn btn-quiet btn-sm !px-2" onClick={() => download(d)} title="Download as text" aria-label="Download"><Download size={14} /></button>
              <button className="btn btn-quiet btn-sm !px-2" onClick={() => remove(d)} title="Delete" aria-label="Delete"><Trash2 size={14} /></button>
            </span>
          </div>
          {d.warnings.length > 0 && (
            <p className="mt-2 flex gap-2 rounded-md bg-[#f8e9c2] px-3 py-2 text-[13px] text-[#5a4208]">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              <span><span className="font-semibold">Check before you send. </span>{d.warnings.join(" ")}</span>
            </p>
          )}
          <textarea
            className="field mt-3 font-mono !text-[13px]" rows={d.kind === "resume" ? 16 : d.kind === "cover" ? 12 : 7} defaultValue={d.content}
            onBlur={(e) => { if (e.target.value !== d.content) void api("/api/documents", { method: "PUT", body: JSON.stringify({ id: d.id, content: e.target.value }) }).then(load); }}
            aria-label={DOCUMENT_LABEL[d.kind]}
          />
        </article>
      ))}
    </section>
  );
}
