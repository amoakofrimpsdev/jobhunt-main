"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, REFRESHED_EVENT } from "@/lib/client";
import type { RefreshStatus } from "@/lib/ingest";

const LINKS = [
  { href: "/", label: "Jobs" },
  { href: "/alerts", label: "Alerts" },
  { href: "/tracker", label: "Tracker" },
  { href: "/profile", label: "Profile" },
  { href: "/sources", label: "Sources" },
  { href: "/settings", label: "Settings" },
];

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <rect x="1" y="12" width="17" height="17" rx="6" fill="#1a3a3a" />
      <circle cx="20" cy="10" r="9" fill="#ff4d8b" />
      <circle cx="11" cy="20" r="5" fill="#e8b94a" />
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const wasRunning = useRef(false);
  const [unseen, setUnseen] = useState(0);

  // The count of unread alert matches, read at start, after each refresh, and when the Alerts page changes it.
  useEffect(() => {
    const read = () => void api<{ unseen: number }>("/api/alerts?count=1").then((r) => setUnseen(r.unseen)).catch(() => undefined);
    const first = setTimeout(read, 0);
    const later = () => setTimeout(read, 1500);
    window.addEventListener(REFRESHED_EVENT, later);
    window.addEventListener("jobhunt:alerts-changed", read);
    return () => { clearTimeout(first); window.removeEventListener(REFRESHED_EVENT, later); window.removeEventListener("jobhunt:alerts-changed", read); };
  }, []);

  const poll = useCallback(async () => {
    try {
      const s = await api<RefreshStatus>("/api/refresh");
      setStatus(s);
      // Screens reload while boards are still being read, so jobs show up as they arrive.
      if (s.running || wasRunning.current) window.dispatchEvent(new CustomEvent(REFRESHED_EVENT, { detail: s }));
      wasRunning.current = s.running;
    } catch {
      // The next tick tries again.
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(poll, 0);
    const id = setInterval(() => { if (wasRunning.current) void poll(); }, 2500);
    const kick = () => { wasRunning.current = true; void poll(); };
    window.addEventListener("jobhunt:refresh-started", kick);
    return () => { clearTimeout(first); clearInterval(id); window.removeEventListener("jobhunt:refresh-started", kick); };
  }, [poll]);

  async function refresh() {
    const s = await api<RefreshStatus>("/api/refresh", { method: "POST", body: "{}" });
    setStatus(s);
    wasRunning.current = s.running;
  }

  const running = status?.running ?? false;
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Jobhunt">
          <Mark />
          <span className="display hidden text-[22px] sm:block">jobhunt</span>
        </Link>
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="pill" aria-current={pathname === l.href ? "page" : undefined}>
              {l.label}
              {l.href === "/alerts" && unseen > 0 && <span className="rounded-full bg-pink px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">{unseen > 99 ? "99+" : unseen}</span>}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {status && (
            <span className="hidden text-[13px] text-muted lg:block" aria-live="polite">
              {running
                ? `Reading ${status.current ?? "boards"} · ${status.done} of ${status.total}`
                : status.lastFullAt ?? status.finishedAt
                  ? `Boards read ${new Date((status.lastFullAt ?? status.finishedAt)!).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                  : "Boards not read yet"}
            </span>
          )}
          <button className="btn btn-primary" onClick={refresh} disabled={running} aria-label={running ? "Reading boards" : "Refresh jobs"}>
            <RefreshCw size={15} className={running ? "animate-spin" : ""} />
            <span className="hidden md:inline">{running ? "Reading boards" : "Refresh jobs"}</span>
          </button>
        </div>
      </div>
      {running && status && (
        <div className="h-[3px] bg-surface-strong">
          <div className="h-full bg-pink transition-[width] duration-700" style={{ width: `${Math.max(4, (100 * status.done) / Math.max(1, status.total))}%` }} />
        </div>
      )}
    </header>
  );
}
