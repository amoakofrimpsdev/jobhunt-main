// Application answers: the details every form asks for (name, email, phone, links, work authorization) and the
// answers the browser extension recorded while the person filled an application by hand. They live in the local
// database only, and the extension is handed them only after it has been paired.
import { listResumes } from "./resumes";
import { db, getProfile } from "./store";

export type Answer = { key: string; label: string; value: string; kind: string; site: string; uses: number; updatedAt: string };

/** The details with a fixed meaning. Everything else is a recorded question, keyed by its wording ("q:..."). */
export const STANDARD_ANSWERS: Array<{ key: string; label: string; hint?: string }> = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "preferred_name", label: "Preferred name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "city", label: "City and state", hint: "As you would type it: Seattle, WA" },
  { key: "country", label: "Country" },
  { key: "address", label: "Street address" },
  { key: "zip", label: "ZIP code" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "github", label: "GitHub" },
  { key: "website", label: "Website or portfolio" },
  { key: "current_company", label: "Current company" },
  { key: "current_title", label: "Current title" },
  { key: "school", label: "School" },
  { key: "degree", label: "Degree" },
  { key: "major", label: "Field of study" },
  { key: "graduation_year", label: "Graduation year" },
  { key: "work_authorized", label: "Authorized to work in the US", hint: "Yes or No" },
  { key: "needs_sponsorship", label: "Will need visa sponsorship", hint: "Yes or No" },
  { key: "salary", label: "Salary expectation" },
  { key: "start_date", label: "Earliest start date or notice period" },
  { key: "pronouns", label: "Pronouns" },
  { key: "how_heard", label: "How you heard about the job" },
];

type Row = Record<string, unknown>;
const toAnswer = (r: Row): Answer => ({
  key: r.key as string, label: r.label as string, value: r.value as string, kind: r.kind as string,
  site: r.site as string, uses: r.uses as number, updatedAt: r.updated_at as string,
});

export function listAnswers(): Answer[] {
  return (db().prepare("SELECT * FROM answers ORDER BY updated_at DESC").all() as Row[]).map(toAnswer);
}

export function saveAnswer(a: { key: string; label: string; value: string; kind?: string; site?: string }): void {
  const key = a.key.slice(0, 300);
  if (!key) return;
  if (!a.value.trim()) { db().prepare("DELETE FROM answers WHERE key = ?").run(key); return; }
  db().prepare(`INSERT INTO answers (key, label, value, kind, site, uses, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT (key) DO UPDATE SET label = excluded.label, value = excluded.value, kind = excluded.kind, site = excluded.site, updated_at = excluded.updated_at`)
    .run(key, a.label.slice(0, 300), a.value.slice(0, 6000), a.kind ?? "text", (a.site ?? "").slice(0, 100), new Date().toISOString());
}

export function removeAnswer(key: string): void {
  db().prepare("DELETE FROM answers WHERE key = ?").run(key);
}

/**
 * Fills in details that are still empty from what the app already knows: the name and sponsorship answer from the
 * profile, and the email, phone and links printed at the top of the first resume. Nothing already saved is changed.
 */
export function seedAnswers(): void {
  const have = new Set(listAnswers().map((a) => a.key));
  const put = (key: string, value: string | undefined | null) => {
    if (!value || have.has(key)) return;
    saveAnswer({ key, label: STANDARD_ANSWERS.find((s) => s.key === key)?.label ?? key, value });
    have.add(key);
  };
  const p = getProfile();
  const names = p.name.trim().split(/\s+/);
  if (names.length >= 2) { put("first_name", names[0]); put("last_name", names.slice(1).join(" ")); }
  if (p.name) put("needs_sponsorship", p.needsSponsorship ? "Yes" : "No");
  const resume = listResumes()[0];
  if (!resume) return;
  const head = ((db().prepare("SELECT text FROM resumes WHERE id = ?").get(resume.id) as { text: string } | undefined)?.text ?? "").slice(0, 1500);
  put("email", /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(head)?.[0]);
  put("phone", /(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.exec(head)?.[0]);
  const link = (re: RegExp) => { const m = re.exec(head)?.[0]; return m ? (m.startsWith("http") ? m : `https://${m}`) : null; };
  put("linkedin", link(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w%-]+/i));
  put("github", link(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+/i));
}
