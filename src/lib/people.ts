// LinkedIn people searches for one job, as plain links the person opens in their own browser. Jobhunt never contacts
// or reads LinkedIn: it only writes the address of a search, and LinkedIn shows the results to the signed-in person.

export type PeopleSearch = { key: string; label: string; hint: string; url: string };

/** A company name as LinkedIn would list it: legal endings dropped ("Acme, Inc." -> "Acme"). */
export function companyTerm(company: string): string {
  return company.replace(/[,\s]+(inc|llc|ltd|corp|corporation|co|company|plc|gmbh|l\.?p)\.?$/i, "").replace(/"/g, "").trim();
}

// Who usually manages the role a title names. A guess from the title's words, shown as "likely".
const MANAGERS: Array<[RegExp, string]> = [
  [/\b(machine learning|ml|ai|data scien|research scien)/i, "machine learning manager"],
  [/\b(data engineer|analytics engineer)/i, "data engineering manager"],
  [/\b(data anal|business intelligence|bi anal|analytics)/i, "analytics manager"],
  [/\b(product manager|product owner)/i, "director of product"],
  [/\b(design|ux|ui\/ux|user experience)/i, "design manager"],
  [/\b(security|infosec)/i, "security manager"],
  [/\b(engineer|developer|software|swe|sre|devops|programmer|full[- ]?stack|front[- ]?end|back[- ]?end)/i, "engineering manager"],
  [/\bmarketing/i, "marketing manager"],
  [/\b(sales|account executive|business development)/i, "sales manager"],
  [/\b(financ|accountant|accounting)/i, "finance manager"],
  [/\b(recruit|talent|people|human resources|hr)\b/i, "head of talent"],
  [/\b(operations|supply chain|logistics)/i, "operations manager"],
  [/\b(customer success|support)/i, "customer success manager"],
];

export function likelyManager(title: string, department: string): string {
  for (const [re, who] of MANAGERS) if (re.test(title)) return who;
  const dep = department.replace(/"/g, "").trim();
  return dep && dep.length <= 40 ? `${dep} manager` : "hiring manager";
}

/**
 * A people search. `company` fills the Company field of LinkedIn's "All filters", and `network` ticks the 1st or 2nd
 * connection chips. The company is in the keywords too, quoted, so the search stays on the employer either way.
 * The "Current companies" chip itself takes LinkedIn's own number for a company, which only LinkedIn knows.
 */
function search(company: string, words: string, network?: Array<"F" | "S">): string {
  const params: Record<string, string> = { keywords: `"${company}"${words ? ` ${words}` : ""}`, company, origin: "FACETED_SEARCH" };
  if (network) params.network = JSON.stringify(network);
  // Spaces as %20: LinkedIn reads a "+" in the address as a plus sign.
  const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `https://www.linkedin.com/search/results/people/?${query}`;
}

/** The searches offered on a job: people you know there, recruiters, and the likely hiring manager. */
export function peopleSearches(job: { company: string; title: string; department: string }): PeopleSearch[] {
  const company = companyTerm(job.company);
  if (!company) return [];
  const manager = likelyManager(job.title, job.department);
  const early = /\b(intern|internship|new grad|graduate|university|campus|entry[- ]level)\b/i.test(job.title);
  const out: PeopleSearch[] = [
    { key: "first", label: "My connections", hint: "1st-degree, at this company", url: search(company, "", ["F"]) },
    { key: "second", label: "Friends of friends", hint: "2nd-degree: ask for an introduction", url: search(company, "", ["S"]) },
    { key: "recruiters", label: "Recruiters", hint: "recruiter, talent acquisition, sourcer", url: search(company, 'recruiter OR "talent acquisition" OR sourcer') },
  ];
  if (early) out.push({ key: "campus", label: "University recruiters", hint: "university, campus, early careers", url: search(company, '"university recruiter" OR "campus recruiter" OR "early careers"') });
  out.push({ key: "manager", label: "Likely hiring manager", hint: manager, url: search(company, `"${manager}"`) });
  return out;
}
