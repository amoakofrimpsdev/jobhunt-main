/** The last four are single employers that run a careers site of their own. "manual" is not a provider: it marks
 *  jobs the person saved from a page in their browser. */
export type Ats = "greenhouse" | "lever" | "ashby" | "workday" | "workable" | "icims" | "oracle" | "jazzhr" | "bamboohr" | "smartrecruiters"
  | "personio" | "teamtailor" | "amazon" | "microsoft" | "apple" | "meta" | "nhs" | "manual";
/** Employers read from their own careers site: one board each. */
export const COMPANY_SITES: Array<{ ats: Ats; slug: string; name: string; host: string; uk?: boolean }> = [
  { ats: "amazon", slug: "us", name: "Amazon", host: "amazon.jobs" },
  { ats: "microsoft", slug: "us", name: "Microsoft", host: "careers.microsoft.com" },
  { ats: "apple", slug: "us", name: "Apple", host: "jobs.apple.com" },
  { ats: "meta", slug: "all", name: "Meta", host: "metacareers.com" },
  // NHS trusts and practices post their own vacancies on NHS Jobs. Read only when the feed includes the UK.
  { ats: "nhs", slug: "all", name: "NHS Jobs", host: "jobs.nhs.uk", uk: true },
];
export const ATS_LABEL: Record<Ats, string> = {
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", workable: "Workable", icims: "iCIMS",
  oracle: "Oracle", jazzhr: "JazzHR", bamboohr: "BambooHR", smartrecruiters: "SmartRecruiters", personio: "Personio",
  teamtailor: "Teamtailor", amazon: "Amazon Jobs", microsoft: "Microsoft Careers", apple: "Apple Jobs", meta: "Meta Careers",
  nhs: "NHS Jobs", manual: "Browser",
};
export type WorkModel = "remote" | "hybrid" | "onsite";
export type Level = "intern" | "entry" | "mid" | "senior" | "staff" | "manager" | "director" | "exec";
export type PayPeriod = "year" | "month" | "hour";
/** Where a job is. "US_UK": it lists places in both. "unknown": it names no country (a bare "Remote"). */
export type Country = "US" | "UK" | "US_UK" | "other" | "unknown";
/** The countries the feed shows. */
export type Region = "us" | "uk" | "us_uk" | "any";
export const REGION_LABEL: Record<Region, string> = { us: "United States", uk: "United Kingdom", us_uk: "US and UK", any: "Anywhere" };
export type Band = "strong" | "good" | "fair" | "low";
export type TrackStatus = "saved" | "applied" | "interviewing" | "offer" | "rejected" | "archived";

export const TRACK_STATUSES: TrackStatus[] = ["saved", "applied", "interviewing", "offer", "rejected", "archived"];
export const LEVELS: Level[] = ["intern", "entry", "mid", "senior", "staff", "manager", "director", "exec"];
export const LEVEL_LABEL: Record<Level, string> = {
  intern: "Intern", entry: "Entry level", mid: "Mid level", senior: "Senior", staff: "Staff / Principal",
  manager: "Manager", director: "Director", exec: "Executive",
};

/** One posting as a board reader returns it, before the parsers read its text. */
export type RawJob = {
  externalId: string;
  url: string;
  applyUrl: string;
  title: string;
  company: string;
  location: string;
  descriptionHtml: string;
  workModel: WorkModel | null;
  employmentType: string | null;
  department: string;
  postedAt: string | null;
  countryCode: string | null;
  pay: { min: number | null; max: number | null; currency: string; period: PayPeriod } | null;
};

export type Board = {
  id: number;
  ats: Ats;
  slug: string;
  name: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  openJobs: number;
  /** Added by hand or part of the starter set, as opposed to only followed through a collection. */
  direct: boolean;
  /** Read on a refresh: switched on, and either direct or in a collection that is switched on. */
  active: boolean;
};

/** A site that lists many employers (a venture firm's portfolio board, a Simplify list) and the boards behind it. */
export type Collection = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  boards: number;
  openJobs: number;
  /** Boards the collection lists on providers Jobhunt has no reader for, by provider. */
  notRead: Record<string, number>;
  /** A fixed list with no site of its own to re-read for new employers. */
  fixed: boolean;
  /** When the collection's own site was last read for new employers, and what that found. */
  lastCheckedAt: string | null;
  lastResult: string | null;
};

export type Profile = {
  name: string;
  targetTitles: string[];
  skills: string[];
  years: number | null;
  level: Level | null;
  locations: string[];
  remoteOk: boolean;
  needsSponsorship: boolean;
  /** The countries the feed shows. */
  region: Region;
  resumeName: string | null;
  updatedAt: string | null;
};

export const EMPTY_PROFILE: Profile = {
  name: "", targetTitles: [], skills: [], years: null, level: null, locations: [], remoteOk: true,
  needsSponsorship: false, region: "us", resumeName: null, updatedAt: null,
};

export type MatchPart = { key: "role" | "skills" | "level"; label: string; score: number | null; reasons: string[] };

export type Match = {
  score: number;
  band: Band;
  parts: MatchPart[];
  matchedSkills: string[];
  missingSkills: string[];
  /** Set when a blocker limits the score, with the reason shown next to it. */
  cap: string | null;
};

export type JobCard = {
  id: string;
  title: string;
  company: string;
  location: string;
  country: Country;
  workModel: WorkModel | null;
  employmentType: string | null;
  level: Level | null;
  yearsMin: number | null;
  payMin: number | null;
  payMax: number | null;
  payCurrency: string | null;
  payPeriod: PayPeriod | null;
  postedAt: string | null;
  firstSeenAt: string;
  /** The posting arrived on a board that was already being followed, so the day it was first seen is about the day it went up. */
  seenNew: boolean;
  url: string;
  ats: Ats;
  /** Saved from the board's list alone: the posting's text, and so what it says about visas, has not been read. */
  unread: boolean;
  sponsorship: "yes" | "no" | null;
  eVerify: boolean | null;
  blocker: "clearance" | "citizenship" | "no_sponsorship" | null;
  h1bFilings: number;
  capExempt: boolean;
  /** The employer is on the UK Home Office register of licensed sponsors (by name). */
  ukSponsor: boolean;
  closedAt: string | null;
  match: Match | null;
  status: TrackStatus | null;
};

export type JobDetail = JobCard & {
  applyUrl: string;
  department: string;
  descriptionHtml: string;
  blockerText: string | null;
  evidence: Record<string, string>;
  skills: Array<{ id: string; name: string; have: boolean }>;
  notes: string;
  /** How each resume in the library scores on this job, best first. Empty when the library is empty. */
  resumes: ResumeFit[];
};

export type DocumentKind = "fit" | "resume" | "cover" | "message";
export const DOCUMENT_KINDS: DocumentKind[] = ["fit", "resume", "cover", "message"];
export const DOCUMENT_LABEL: Record<DocumentKind, string> = { fit: "Fit summary", resume: "Tailored resume", cover: "Cover letter", message: "Outreach message" };

/** Something written for one job, by a model in the app or by Claude Desktop through the connector. */
export type JobDocument = {
  id: number;
  jobId: string;
  kind: DocumentKind;
  content: string;
  /** Who wrote it: "local", "anthropic", "openai" or "claude-desktop". */
  source: string;
  resumeName: string | null;
  /** Things in the text that the resume and the posting do not back up, for the person to check. */
  warnings: string[];
  createdAt: string;
  updatedAt: string;
};

export type AiProvider = "none" | "local" | "anthropic" | "openai" | "claude-desktop";

export type AiSettings = {
  provider: AiProvider;
  localUrl: string;
  localModel: string;
  anthropicModel: string;
  openaiModel: string;
};

/** A resume in the library: an uploaded file, or one found in the folder the person pointed the app at. */
export type Resume = {
  id: string;
  name: string;
  source: "upload" | "folder";
  skills: string[];
  titles: string[];
  years: number | null;
  addedAt: string;
};

export type ResumeFit = {
  id: string;
  name: string;
  score: number;
  band: Band;
  /** Skills the posting names that this resume shows. */
  matched: string[];
  /** Of those, the ones the main profile does not list. */
  extra: string[];
  /** Scores higher than the main profile does on this job. */
  better: boolean;
};
