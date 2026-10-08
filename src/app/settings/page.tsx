"use client";

import { Check, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { ConnectorStatus } from "@/lib/connector";
import type { AiProvider, AiSettings } from "@/lib/types";

type State = {
  settings: AiSettings;
  anthropicModels: string[];
  localModels: string[];
  localError: string | null;
  keys: { anthropic: boolean; openai: boolean };
  connector: ConnectorStatus;
};

const PROVIDERS: Array<{ id: AiProvider; name: string; line: string; className: string }> = [
  { id: "none", name: "Off", line: "No AI. Search, scores, resume picks and the tracker never need it.", className: "bg-surface-card" },
  { id: "local", name: "A model on this computer", line: "Ollama, LM Studio or any OpenAI-compatible server. Nothing leaves the Mac.", className: "bg-mint" },
  { id: "claude-desktop", name: "Claude Desktop", line: "Claude does the writing in its own window, on your Claude plan, and saves it back here. No key.", className: "bg-lavender" },
  { id: "anthropic", name: "Anthropic API key", line: "Claude, inside Jobhunt. Pay per use on your own key.", className: "bg-peach" },
  { id: "openai", name: "OpenAI API key", line: "GPT, inside Jobhunt. Pay per use on your own key.", className: "bg-ochre" },
];

export default function SettingsPage() {
  const [state, setState] = useState<State | null>(null);
  const [form, setForm] = useState<AiSettings | null>(null);
  const [keys, setKeys] = useState({ anthropic: "", openai: "" });
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "connector" | null>(null);

  useEffect(() => {
    const t = setTimeout(() => void api<State>("/api/ai").then((s) => { setState(s); setForm(s.settings); }), 0);
    return () => clearTimeout(t);
  }, []);

  if (!state || !form) return <main className="mx-auto max-w-[1280px] px-4 pt-12 sm:px-6"><div className="h-64 animate-pulse rounded-xl bg-surface-card" /></main>;

  const patch = (p: Partial<AiSettings>) => { setForm({ ...form, ...p }); setNote(null); };

  async function save(extra: Record<string, unknown> = {}): Promise<State | null> {
    setBusy("save");
    try {
      const s = await api<State>("/api/ai", { method: "PUT", body: JSON.stringify({ ...form, ...extra }) });
      setState(s);
      setForm(s.settings);
      setKeys({ anthropic: "", openai: "" });
      setNote({ ok: true, text: "Saved." });
      return s;
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    const body: Record<string, unknown> = {};
    if (keys.anthropic) body.anthropicKey = keys.anthropic;
    if (keys.openai) body.openaiKey = keys.openai;
    if (!(await save(body))) return;
    setBusy("test");
    try {
      const r = await api<{ text: string }>("/api/ai", { method: "POST", body: JSON.stringify({ test: true }) });
      setNote({ ok: true, text: `It works. The model said: “${r.text.slice(0, 120)}”` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function addConnector() {
    setBusy("connector");
    try {
      const connector = await api<ConnectorStatus>("/api/claude", { method: "POST", body: JSON.stringify({ install: true }) });
      setState({ ...state!, connector });
      setNote({ ok: true, text: "Added. Quit Claude Desktop completely and open it again; Jobhunt then appears among its connectors." });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const keyField = (name: "anthropic" | "openai", placeholder: string) => (
    <div className="mt-4">
      <label className="eyebrow text-ink/70" htmlFor={`${name}-key`}>API key</label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input id={`${name}-key`} type="password" autoComplete="off" className="field max-w-md" placeholder={state.keys[name] ? "A key is saved. Paste a new one to replace it." : placeholder}
          value={keys[name]} onChange={(e) => setKeys({ ...keys, [name]: e.target.value })} />
        {state.keys[name] && <button className="btn btn-quiet btn-sm" onClick={() => save({ [`${name}Key`]: "" })}>Remove key</button>}
      </div>
      <p className="mt-2 text-[12px] text-ink/70">Kept in the macOS Keychain, never in the database, never shown again, and sent only to {name === "anthropic" ? "Anthropic" : "OpenAI"}.</p>
    </div>
  );

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-24 sm:px-6">
      <section className="pt-12">
        <p className="eyebrow text-muted">Settings</p>
        <h1 className="display mt-3 text-[38px] sm:text-[56px]">AI, on your terms.</h1>
        <p className="mt-3 max-w-2xl text-[16px]">AI is optional and only runs when you click. It explains your fit, tailors a resume, and drafts cover letters and messages, always from what your own resume says. Pick where it runs.</p>
      </section>

      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" role="radiogroup" aria-label="AI provider">
        {PROVIDERS.map((p) => (
          <button key={p.id} role="radio" aria-checked={form.provider === p.id} onClick={() => patch({ provider: p.id })}
            className={`rounded-xl p-5 text-left text-ink transition-shadow ${p.className} ${form.provider === p.id ? "ring-2 ring-ink ring-offset-2 ring-offset-canvas" : "opacity-80 hover:opacity-100"}`}>
            <span className="flex items-center justify-between text-[15px] font-semibold">{p.name}{form.provider === p.id && <Check size={16} />}</span>
            <span className="mt-1 block text-[13px] text-ink/75">{p.line}</span>
          </button>
        ))}
      </div>

      <section className="mt-6 max-w-3xl rounded-xl bg-surface-soft p-6 text-ink sm:p-8">
        {form.provider === "none" && <p className="text-[14px]">AI is off. Nothing is sent to any model.</p>}

        {form.provider === "local" && (
          <>
            <h2 className="display text-[24px]">A model on this computer</h2>
            <label className="eyebrow mt-4 block text-ink/70" htmlFor="local-url">Server address</label>
            <input id="local-url" className="field mt-2 max-w-md" value={form.localUrl} onChange={(e) => patch({ localUrl: e.target.value })} placeholder="http://localhost:11434" />
            <p className="mt-2 text-[12px] text-ink/70">Ollama answers at http://localhost:11434 and LM Studio at http://localhost:1234. Save after changing the address to load its models.</p>
            <label className="eyebrow mt-4 block text-ink/70" htmlFor="local-model">Model</label>
            {state.localModels.length > 0 ? (
              <select id="local-model" className="field mt-2 max-w-md" value={form.localModel} onChange={(e) => patch({ localModel: e.target.value })}>
                <option value="">Choose a model</option>
                {state.localModels.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <p className="mt-2 flex items-start gap-2 text-[13px] text-[#8a1f14]"><CircleAlert size={15} className="mt-0.5 shrink-0" />No model server answered at that address{state.localError ? ` (${state.localError})` : ""}. Start Ollama or LM Studio, then save again.</p>
            )}
          </>
        )}

        {form.provider === "anthropic" && (
          <>
            <h2 className="display text-[24px]">Anthropic API key</h2>
            {keyField("anthropic", "sk-ant-…")}
            <label className="eyebrow mt-4 block text-ink/70" htmlFor="anthropic-model">Model</label>
            <select id="anthropic-model" className="field mt-2 max-w-md" value={form.anthropicModel} onChange={(e) => patch({ anthropicModel: e.target.value })}>
              {state.anthropicModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <p className="mt-2 text-[12px] text-ink/70">Opus writes best and costs most; Haiku is the cheapest. A tailored resume is a few cents on Opus.</p>
          </>
        )}

        {form.provider === "openai" && (
          <>
            <h2 className="display text-[24px]">OpenAI API key</h2>
            {keyField("openai", "sk-…")}
            <label className="eyebrow mt-4 block text-ink/70" htmlFor="openai-model">Model</label>
            <input id="openai-model" className="field mt-2 max-w-md" value={form.openaiModel} onChange={(e) => patch({ openaiModel: e.target.value })} />
          </>
        )}

        {form.provider === "claude-desktop" && (
          <>
            <h2 className="display text-[24px]">Claude Desktop</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[14px]">
              <li>Add the Jobhunt connector to Claude Desktop with the button below, then quit Claude Desktop and open it again.</li>
              <li>On any job here, press a button under “Write with AI”. Claude Desktop opens with the request.</li>
              <li>Claude reads the job and your resume through the connector, writes, and saves the result back onto the job.</li>
            </ol>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="btn btn-primary" onClick={addConnector} disabled={busy !== null || state.connector.installed}>
                {state.connector.installed ? <><Check size={15} /> Added to Claude Desktop</> : busy === "connector" ? "Adding…" : "Add to Claude Desktop"}
              </button>
              {!state.connector.claudeFound && <span className="text-[13px] text-[#8a1f14]">Claude Desktop does not seem to be installed on this Mac.</span>}
            </div>
            <p className="mt-3 text-[12px] text-ink/70">This adds one entry named “jobhunt” to {state.connector.configFile}. Your other connectors are kept and the old file is copied beside it first. Jobhunt has to be open for Claude to reach it.</p>
          </>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-hairline pt-5">
          <button className="btn btn-primary" onClick={() => save({ ...(keys.anthropic ? { anthropicKey: keys.anthropic } : {}), ...(keys.openai ? { openaiKey: keys.openai } : {}) })} disabled={busy !== null}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          {(form.provider === "local" || form.provider === "anthropic" || form.provider === "openai") && (
            <button className="btn btn-secondary" onClick={test} disabled={busy !== null}>{busy === "test" ? "Asking the model…" : "Save and test"}</button>
          )}
          {note && <p className={`text-[14px] ${note.ok ? "text-ink" : "text-[#8a1f14]"}`} role="status">{note.text}</p>}
        </div>
      </section>
      <Details />
    </main>
  );
}

type Answer = { key: string; label: string; value: string; site: string; uses: number };
type AnswersState = { answers: Answer[]; standard: Array<{ key: string; label: string; hint?: string }>; pairingCode: string };

/** The browser extension's pairing code, the details every application asks for, and the answers it has recorded. */
function Details() {
  const [state, setState] = useState<AnswersState | null>(null);
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => void api<AnswersState>("/api/answers").then(setState), 0);
    return () => clearTimeout(t);
  }, []);
  if (!state) return null;

  const valueOf = (key: string) => state.answers.find((a) => a.key === key)?.value ?? "";
  const put = async (key: string, label: string, value: string) => {
    if (value === valueOf(key)) return;
    setState(await api<AnswersState>("/api/answers", { method: "PUT", body: JSON.stringify({ key, label, value }) }));
  };
  const recorded = state.answers.filter((a) => a.key.startsWith("q:"));

  return (
    <>
      <section className="mt-16">
        <p className="eyebrow text-muted">Browser extension</p>
        <h2 className="display mt-3 text-[32px] sm:text-[40px]">Fill applications in one click.</h2>
        <p className="mt-3 max-w-2xl text-[15px]">The Jobhunt extension for Chrome fills application forms from the details below, attaches the resume that fits the job best, and remembers what you type so the next form needs less of you. It never presses Submit.</p>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl bg-teal p-6 text-white sm:p-8">
            <h3 className="display text-[24px] !text-white">Set it up</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[14px] text-white/85">
              <li>Unzip <span className="font-semibold text-white">Jobhunt-extension.zip</span> (next to the app&apos;s disk image, or the <span className="font-semibold text-white">extension</span> folder in the project).</li>
              <li>In Chrome open <span className="font-semibold text-white">chrome://extensions</span>, switch on Developer mode, press Load unpacked and choose that folder.</li>
              <li>Click the Jobhunt icon in Chrome and paste the pairing code.</li>
            </ol>
          </div>
          <div className="rounded-xl bg-surface-card p-6 text-ink sm:p-8">
            <h3 className="display text-[24px]">Pairing code</h3>
            <p className="mt-2 text-[13px] text-ink/75">Only an extension that holds this code is given your answers and resumes, and only on this computer. Make a new code and every extension holding the old one is cut off.</p>
            <code className="mt-4 block break-all rounded-md bg-paper px-3 py-2.5 text-[13px] text-ink">{shown ? state.pairingCode : "•".repeat(32)}</code>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-primary btn-sm" onClick={async () => { await navigator.clipboard.writeText(state.pairingCode).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy code"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShown(!shown)}>{shown ? "Hide" : "Show"}</button>
              <button className="btn btn-quiet btn-sm" onClick={async () => { if (window.confirm("Make a new pairing code? The extension will need the new one.")) setState(await api<AnswersState>("/api/answers", { method: "PUT", body: JSON.stringify({ newCode: true }) })); }}>Make a new code</button>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="display text-[28px]">Application details</h2>
        <p className="mt-1 max-w-2xl text-[14px] text-muted">What nearly every form asks. Each box saves when you leave it. Empty boxes are simply left for you on the form.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.standard.map((f) => (
            <div key={f.key}>
              <label className="text-[13px] font-semibold text-ink" htmlFor={`a-${f.key}`}>{f.label}</label>
              <input id={`a-${f.key}`} className="field mt-1.5" defaultValue={valueOf(f.key)} placeholder={f.hint ?? ""} onBlur={(e) => put(f.key, f.label, e.target.value.trim())} />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="display text-[28px]">Answers the extension recorded</h2>
        <p className="mt-1 max-w-2xl text-[14px] text-muted">Questions you answered by hand while the extension was on. They are filled in when another form asks the same thing. Passwords, ID numbers and card details are never recorded.</p>
        <div className="card mt-4 divide-y divide-hairline overflow-hidden">
          {recorded.map((a) => (
            <div key={a.key} className="flex items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink">{a.label}</p>
                <p className="mt-0.5 line-clamp-2 text-[13px] text-body">{a.value}</p>
                <p className="mt-0.5 text-[12px] text-muted-soft">{a.site}{a.uses ? ` · filled in ${a.uses} ${a.uses === 1 ? "time" : "times"}` : ""}</p>
              </div>
              <button className="btn btn-quiet btn-sm" onClick={async () => setState(await api<AnswersState>(`/api/answers?key=${encodeURIComponent(a.key)}`, { method: "DELETE" }))}>Forget</button>
            </div>
          ))}
          {recorded.length === 0 && <p className="px-5 py-6 text-[14px] text-muted">Nothing yet. Fill one application with the extension on and its answers appear here.</p>}
        </div>
      </section>
    </>
  );
}
