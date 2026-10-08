// What the posting itself says about visa sponsorship, security clearance, citizenship and E-Verify, with the words
// it used. Carried over from jobleft's parser. Equal-opportunity boilerplate ("without regard to citizenship") is
// not a statement about the job.
import { snippet } from "../text";

export type Sponsorship = "yes" | "no" | null;
export type BlockerReason = "clearance" | "citizenship" | "no_sponsorship";

export type Statements = {
  sponsorship: Sponsorship;
  clearanceRequired: boolean | null;
  usCitizenOnly: boolean | null;
  eVerify: boolean | null;
  evidence: Partial<Record<"sponsorship" | "clearanceRequired" | "usCitizenOnly" | "eVerify", string>>;
};

const SPONSOR_NO = /\b(?:(?:unable|not\s+able|cannot|can\s*not|can't|will\s+not|won't|do(?:es)?\s+not|don't|doesn't|is\s+not\s+able\s+to|are\s+not\s+able\s+to)\s+(?:currently\s+)?(?:to\s+)?(?:offer\s+|provide\s+|support\s+)?(?:visa\s+|h-?1b\s+|employment\s+|work\s+)?sponsor(?:ship|ing)?|no\s+(?:visa\s+|h-?1b\s+|employment\s+)?sponsorship|sponsorship\s+(?:is\s+)?(?:not\s+(?:available|offered|provided|possible)|unavailable)|without\s+(?:the\s+need\s+for\s+)?(?:current\s+or\s+future\s+|future\s+|any\s+)?(?:visa\s+|employer\s+|employment\s+|company\s+)?sponsorship|not\s+eligible\s+for\s+(?:visa\s+)?sponsorship|not\s+(?:be\s+)?(?:providing|offering|sponsoring)\s+(?:visa\s+)?sponsorship|sponsorship\s+will\s+not\s+be\s+(?:provided|offered|available|considered)|(?:do(?:es)?\s+not|don't|doesn't|will\s+not|won't|must\s+not|cannot)\s+(?:now\s+or\s+in\s+the\s+future\s+|currently\s+or\s+in\s+the\s+future\s+|now\s+or\s+later\s+|now\s+or\s+at\s+any\s+time\s+in\s+the\s+future\s+)?(?:require|need)\s+(?:(?:visa|employer|employment|immigration|h-?1b|company)\s+)?sponsorship|(?:not|never)\s+(?:now\s+or\s+in\s+the\s+future|currently\s+or\s+in\s+the\s+future)\s+(?:require|need)\s+(?:(?:visa|employer|employment|immigration|h-?1b|company)\s+)?sponsorship)\b/i;
const SPONSOR_YES = /\b(?:(?:we|company|employer|[A-Z][\w&]+)\s+(?:will|can|do(?:es)?|is\s+able\s+to|are\s+able\s+to|may)\s+(?:consider\s+)?(?:offer\s+|provide\s+)?(?:visa\s+|h-?1b\s+)?sponsor(?:ship)?(?!\s+(?:the|our|events?|a\s+team))|(?:visa|h-?1b|employment)\s+sponsorship\s+(?:is\s+)?(?:available|offered|provided|possible)|sponsorship\s+(?:is\s+)?(?:available|offered|provided)|(?:willing|open)\s+to\s+sponsor|will\s+sponsor\s+(?:visas?|h-?1b|qualified|the\s+right)|offers?\s+(?:visa|h-?1b)\s+sponsorship|sponsorship\s+for\s+(?:qualified|eligible)\s+candidates)\b/i;
const CLEARANCE_REQ = /\b(?:(?:active|current|existing)\s+)?(?:ts\/sci|top\s+secret(?:\/sci)?|secret|public\s+trust|dod|doe\s+[lq]|q|l)\s+(?:level\s+)?(?:security\s+)?clearance(?:\s+with\s+(?:full[- ]scope\s+|ci\s+)?poly(?:graph)?)?\s+(?:is\s+)?(?:required|needed|mandatory)|\b(?:must|required\s+to|need\s+to|should)\s+(?:have|hold|possess|maintain|obtain|be\s+able\s+to\s+obtain|be\s+eligible\s+(?:to|for))\s+(?:an?\s+)?(?:active\s+|current\s+)?(?:(?:ts\/sci|top\s+secret|secret|public\s+trust|dod|government|federal|u\.?s\.?\s+government)\s+)?(?:security\s+)?clearance|\bclearance\s+(?:is\s+)?required\b|\brequires?\s+(?:an?\s+)?(?:active\s+)?(?:ts\/sci|top\s+secret|secret|security)\s+clearance|\bability\s+to\s+(?:obtain|get)\s+(?:and\s+maintain\s+)?(?:an?\s+)?(?:(?:ts\/sci|top\s+secret|secret|public\s+trust|dod|government|federal)\s+)?(?:security\s+)?clearance\b|\b(?:active|current)\s+(?:ts\/sci|top\s+secret|secret)\s+clearance\b/i;
const CLEARANCE_NO = /\b(?:no\s+(?:security\s+)?clearance\s+(?:is\s+)?(?:required|needed)|(?:security\s+)?clearance\s+(?:is\s+)?not\s+required|does\s+not\s+require\s+(?:a\s+)?(?:security\s+)?clearance)\b/i;
const CITIZEN_ONLY = /\b(?:(?:must|required\s+to|need\s+to)\s+be\s+(?:a\s+)?(?:u\.?\s?s\.?|united\s+states|american)\s+citizen(?!\s+or\b)(?!\s*(?:,|\/)\s*(?:or\s+)?(?:green\s+card|permanent|lawful|national))|(?:u\.?\s?s\.?|united\s+states)\s+citizenship\s+(?:is\s+)?(?:required|mandatory|a\s+requirement)|(?:open|available)\s+(?:only\s+)?to\s+(?:u\.?\s?s\.?|united\s+states)\s+citizens\s+only|(?:u\.?\s?s\.?|united\s+states)\s+citizens\s+only|only\s+(?:u\.?\s?s\.?|united\s+states)\s+citizens|requires?\s+(?:u\.?\s?s\.?|united\s+states)\s+citizenship)\b/i;
const CITIZEN_OR_PR = /\b(?:u\.?\s?s\.?|united\s+states)\s+citizens?\s*(?:,|\/|or)\s*(?:or\s+)?(?:(?:lawful\s+)?permanent\s+residents?|green\s+card\s+holders?|u\.?s\.?\s+nationals?)|\bu\.?s\.?\s+persons?\b/i;
// A STEM OPT extension needs an E-Verify employer.
const E_VERIFY = /\be-?\s?verify\b/i;
const E_VERIFY_NO = /\b(?:(?:does|do|will)\s+not|doesn't|don't|won't|not(?:\s+an?)?|never)\s+(?:currently\s+)?(?:participate\s+in|use|enrolled\s+in|enroll\s+in|registered\s+(?:with|in)|an?\s+)?\s*e-?\s?verify\b/i;
const EEO = /\b(?:without\s+regard\s+to|regardless\s+of|discriminat\w*|protected\s+(?:veteran|class|characteristic)|equal\s+(?:employment\s+)?opportunity|e-?verify|i-9|form\s+i-9|export\s+control\s+laws?|itar|ear)\b/i;

type Hit = { index: number; end: number };

function find(re: RegExp, text: string): Hit | null {
  const m = re.exec(text);
  return m ? { index: m.index, end: m.index + m[0].length } : null;
}

function notEeo(text: string, hit: Hit | null): hit is Hit {
  if (!hit) return false;
  const s = text.slice(Math.max(0, hit.index - 80), Math.min(text.length, hit.end + 40));
  return !/\bwithout\s+regard\s+to\b|\bregardless\s+of\b|\bdiscriminat/i.test(s);
}

/** null on a field = the posting says nothing about it. */
export function parseStatements(text: string): Statements {
  const out: Statements = { sponsorship: null, clearanceRequired: null, usCitizenOnly: null, eVerify: null, evidence: {} };
  if (!text) return out;

  const evNo = find(E_VERIFY_NO, text);
  const evYes = evNo ? null : find(E_VERIFY, text);
  if (evNo) { out.eVerify = false; out.evidence.eVerify = snippet(text, evNo.index, evNo.end); }
  else if (evYes) { out.eVerify = true; out.evidence.eVerify = snippet(text, evYes.index, evYes.end); }

  const no = find(SPONSOR_NO, text);
  const yes = find(SPONSOR_YES, text);
  if (notEeo(text, no)) {
    out.sponsorship = "no";
    out.evidence.sponsorship = snippet(text, no.index, no.end);
  } else if (notEeo(text, yes) && !/\bnot\b|\bno\b|\bunable\b/i.test(text.slice(Math.max(0, yes.index - 20), yes.index))) {
    out.sponsorship = "yes";
    out.evidence.sponsorship = snippet(text, yes.index, yes.end);
  }

  const cr = find(CLEARANCE_REQ, text);
  const cn = find(CLEARANCE_NO, text);
  if (cn) { out.clearanceRequired = false; out.evidence.clearanceRequired = snippet(text, cn.index, cn.end); }
  else if (cr && !/\b(?:prefer(?:red)?|a\s+plus|nice\s+to\s+have|desired|bonus)\b/i.test(text.slice(cr.index, Math.min(text.length, cr.end + 30)))) {
    out.clearanceRequired = true;
    out.evidence.clearanceRequired = snippet(text, cr.index, cr.end);
  }

  const co = find(CITIZEN_ONLY, text);
  const pr = find(CITIZEN_OR_PR, text);
  if (notEeo(text, co) && !(pr && Math.abs(pr.index - co.index) < 40)) {
    out.usCitizenOnly = true;
    out.evidence.usCitizenOnly = snippet(text, co.index, co.end);
  } else if (notEeo(text, pr) && !EEO.test(text.slice(Math.max(0, pr.index - 60), pr.index))) {
    out.usCitizenOnly = false;
    out.evidence.usCitizenOnly = snippet(text, pr.index, pr.end);
  }
  return out;
}

// Clearance words as postings really write them ("TS/SCI w/ poly", "must be clearable"): wider than CLEARANCE_REQ,
// which wants a full sentence. Used where a miss costs more than a false alarm.
const CLEARANCE_WORDS = /\b(?:ts\s?\/\s?sci|top\s+secret|polygraph|(?:ci|fs|full[- ]scope)\s+poly|(?:security|secret|dod|doe|government|federal|interim|active|current)\s+clearances?|public\s+trust\s+(?:position|role|clearance|level|eligib\w+|suitability|background|investigation|determination)|clearance\s+(?:level|type|requirements?|required|eligib\w+)|(?:obtain|maintain|hold|possess|have)\s+(?:an?\s+|and\s+maintain\s+an?\s+)?(?:\w+\s+){0,2}clearance|clearable|cleared\s+(?:position|role|candidates?|professionals?|personnel))\b/gi;
const SOFT = /\b(?:prefer(?:red|ably)?|a\s+plus|nice\s+to\s+have|desired|desirable|bonus|not\s+required|optional|valuable|an\s+advantage|helpful|beneficial|may\s+be\s+necessary|(?:certain|some)\s+(?:roles|positions|jobs)|may\s+(?:be\s+)?require)/i;
const VISA_WORDS = /clearance|cleared|clearable|citizen|sponsor|secret|ts\s?\/\s?sci|poly|public\s+trust|u\.?s\.?\s+persons?/i;

/**
 * Why a person who needs sponsorship cannot take this job, in the posting's own words; null when it names no such
 * limit. A clearance that is only preferred is not a limit.
 */
export function visaBlocker(title: string, text: string, s: Statements): { reason: BlockerReason; text: string } | null {
  if (!VISA_WORDS.test(title) && !VISA_WORDS.test(text)) return null;
  if (s.sponsorship === "no") return { reason: "no_sponsorship", text: s.evidence.sponsorship ?? "" };
  if (s.usCitizenOnly === true) return { reason: "citizenship", text: s.evidence.usCitizenOnly ?? "" };
  const maybe = /\b(?:certain|some)\s+(?:roles|positions|jobs)\b|\bmay\s+(?:be\s+)?require/i;
  if (s.clearanceRequired === true && !maybe.test(s.evidence.clearanceRequired ?? "")) return { reason: "clearance", text: s.evidence.clearanceRequired ?? "" };
  if (s.clearanceRequired === false) return null;
  if (/\b(?:clearance|cleared|ts\s?\/\s?sci|top\s+secret|poly)\b/i.test(title)) return { reason: "clearance", text: title };
  for (const m of text.matchAll(CLEARANCE_WORDS)) {
    const end = m.index + m[0].length;
    const stop = text.indexOf("\n", end);
    const around = text.slice(Math.max(0, m.index - 60), Math.min(text.length, end + 160, stop === -1 ? text.length : Math.max(stop, end + 60)));
    if (SOFT.test(around) || /\bwithout\s+regard\s+to\b|\bregardless\s+of\b|\bdiscriminat/i.test(around)) continue;
    return { reason: "clearance", text: snippet(text, m.index, end) };
  }
  return null;
}
