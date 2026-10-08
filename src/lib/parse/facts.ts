// Facts read from a posting's title, location and text: level, years asked for, work model, pay and country.
// Each returns null when the posting does not say; nothing is guessed from the size of a number.
import type { Country, Level, PayPeriod, WorkModel } from "../types";

const IC_MANAGER = /\b(?:product|program|project|account|success|community|partner|case|office|content|social\s+media|campaign|brand|portfolio|category|relationship|territory|property|delivery|engagement|customer|client|marketing)\s+(?:\w+\s+)?manager\b/i;

export function levelOfTitle(title: string): Level | null {
  const t = title.toLowerCase();
  if (/\b(?:intern|internship|co-?op|apprentice(?:ship)?|working\s+student)\b/.test(t)) return "intern";
  if (/\b(?:chief|c[efiot]o|vp|svp|evp|vice\s+president|head\s+of|president)\b/.test(t)) return "exec";
  if (/\bdirector\b/.test(t)) return "director";
  if (/\b(?:staff|principal|distinguished|fellow)\b/.test(t)) return "staff";
  if (/\b(?:manager|mgr|supervisor)\b/.test(t) && !IC_MANAGER.test(t)) return "manager";
  if (/\b(?:senior|sr|lead|iii|iv)\b/.test(t)) return "senior";
  if (/\b(?:junior|jr|entry[- ]level|new\s+grad(?:uate)?|graduate|early\s+career|university\s+grad|associate)\b/.test(t) || /\bI$/.test(title.trim())) return "entry";
  if (/\b(?:ii|mid[- ]level)\b/.test(t)) return "mid";
  return null;
}

export function levelOfYears(years: number): Level {
  if (years < 2) return "entry";
  if (years < 5) return "mid";
  if (years < 9) return "senior";
  return "staff";
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15 };
const YEARS = /(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)\s*(?:\(\d{1,2}\)\s*)?(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*\+?\s*)?(?:years?|yrs?)\b/gi;
const EXPERIENCE_AFTER = /^[^.;\n]{0,90}?\b(?:experience|exp\b|expertise|background|working|track\s+record|hands[- ]on|in\s+an?\s|in\s+the\s|as\s+an?\s|of\s+\w+ing\b)/i;
const NOT_EXPERIENCE = /\b(?:age|aged|older|old|vest\w*|over\s+the\s+(?:next|last|past)|for\s+(?:over|more\s+than|nearly|almost)|in\s+business|founded|history|anniversary|warranty|contract\s+term)\s*$/i;
const PREFERRED = /\b(?:prefer(?:red|ably)?|nice[- ]to[- ]have|a\s+plus|bonus|ideally|desired)\b/i;

/** The years of experience a posting asks for: the first required figure, else the first preferred one. */
export function yearsRequired(text: string): { min: number; evidence: string } | null {
  let preferred: { min: number; evidence: string } | null = null;
  for (const m of text.matchAll(YEARS)) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : WORD_NUM[m[1].toLowerCase()];
    if (!Number.isFinite(n) || n > 20) continue;
    const end = m.index + m[0].length;
    if (!EXPERIENCE_AFTER.test(text.slice(end, end + 110))) continue;
    if (NOT_EXPERIENCE.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const lineEnd = text.indexOf("\n", end);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
    const hit = { min: n, evidence: line.length > 220 ? `${line.slice(0, 217)}…` : line };
    if (PREFERRED.test(line)) { preferred ??= hit; continue; }
    return hit;
  }
  return preferred;
}

export function workModelOf(field: string | null, location: string, text: string): WorkModel | null {
  const f = (field ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (f === "remote") return "remote";
  if (f === "hybrid") return "hybrid";
  if (f === "onsite" || f === "inoffice") return "onsite";
  if (/\bhybrid\b/i.test(location)) return "hybrid";
  if (/\bremote\b/i.test(location)) return "remote";
  const head = text.slice(0, 4000);
  if (/\b(?:hybrid\s+(?:role|position|work|schedule|model|environment)|\d\s+days?\s+(?:a|per)\s+week\s+(?:in|at)\s+(?:the|our)\s+office|in[- ]office\s+\d\s+days)\b/i.test(head)) return "hybrid";
  if (/\b(?:fully\s+remote|100%\s+remote|remote[- ]first|work\s+from\s+anywhere|this\s+(?:is\s+a\s+)?remote\s+(?:role|position))\b/i.test(head)) return "remote";
  if (/\b(?:on-?site\s+(?:role|position)|fully\s+on-?site|in[- ]person\s+(?:role|position)|5\s+days\s+(?:a|per)\s+week\s+in)\b/i.test(head)) return "onsite";
  return null;
}

const money = (s: string) => (/k$/i.test(s) ? Number(s.slice(0, -1).replace(/,/g, "")) * 1000 : Number(s.replace(/,/g, "")));
const SALARY = /\$\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d)?k)(?:\.\d{2})?\s*(?:USD\s*)?(?:-|–|—|to|and)\s*\$?\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d)?k)/i;
const HOURLY = /\$\s?(\d{2,3}(?:\.\d{2})?)\s*(?:-|–|—|to)\s*\$?\s?(\d{2,3}(?:\.\d{2})?)\s*(?:\/|per\s+|an\s+)h(?:ou)?r/i;

/** A pay range the posting text states in dollars, with its own unit. */
export function payFromText(text: string): { min: number; max: number; currency: string; period: PayPeriod } | null {
  const h = HOURLY.exec(text);
  if (h) {
    const min = Number(h[1]), max = Number(h[2]);
    if (min >= 7 && max >= min && max <= 500) return { min, max, currency: "USD", period: "hour" };
  }
  const s = SALARY.exec(text);
  if (s) {
    const min = money(s[1]), max = money(s[2]);
    if (min >= 20000 && max >= min && max <= 2_000_000) return { min, max, currency: "USD", period: "year" };
  }
  return null;
}

const STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const US_MARK = new RegExp(String.raw`\b(?:united\s+states|usa|u\.s\.a?\.?|us|nyc|bay\s+area|silicon\s+valley|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s+hampshire|new\s+jersey|new\s+mexico|new\s+york|north\s+carolina|north\s+dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s+island|south\s+carolina|south\s+dakota|tennessee|texas|utah|vermont|virginia|washington|wisconsin|wyoming|san\s+francisco|seattle|austin|boston|chicago|los\s+angeles|denver|atlanta|san\s+jose|san\s+diego|palo\s+alto|mountain\s+view|sunnyvale|menlo\s+park|redwood\s+city|brooklyn|manhattan|dallas|houston|miami|philadelphia|pittsburgh|portland|phoenix|minneapolis|detroit|raleigh|durham|nashville|salt\s+lake\s+city|boulder|cambridge,\s*ma|santa\s+clara|irvine|bellevue|arlington)\b|,\s*(?:${STATES})\b`, "i");
const NON_US_MARK = /\b(?:canada|toronto|vancouver|montreal|ottawa|calgary|united\s+kingdom|uk|u\.k\.|england|london|manchester|edinburgh|scotland|ireland|dublin|germany|berlin|munich|hamburg|france|paris|netherlands|amsterdam|spain|madrid|barcelona|portugal|lisbon|italy|milan|rome|poland|warsaw|krakow|romania|bucharest|sweden|stockholm|denmark|copenhagen|norway|oslo|finland|helsinki|switzerland|zurich|geneva|austria|vienna|belgium|brussels|czech|prague|hungary|budapest|greece|athens|turkey|istanbul|ukraine|kyiv|serbia|belgrade|bulgaria|sofia|estonia|tallinn|lithuania|latvia|india|bangalore|bengaluru|hyderabad|pune|mumbai|delhi|gurgaon|gurugram|chennai|noida|singapore|australia|sydney|melbourne|brisbane|new\s+zealand|auckland|japan|tokyo|korea|seoul|china|shanghai|beijing|shenzhen|hong\s+kong|taiwan|taipei|philippines|manila|vietnam|thailand|bangkok|indonesia|jakarta|malaysia|kuala\s+lumpur|israel|tel\s+aviv|uae|dubai|abu\s+dhabi|saudi|riyadh|qatar|egypt|cairo|nigeria|lagos|kenya|nairobi|south\s+africa|cape\s+town|johannesburg|ghana|accra|brazil|s[aã]o\s+paulo|mexico|mexico\s+city|guadalajara|argentina|buenos\s+aires|colombia|bogot[aá]|chile|santiago|peru|lima|costa\s+rica|emea|apac|latam|europe|asia|africa|latin\s+america|luxembourg|cyprus|malta|pakistan|bangladesh|sri\s+lanka)\b/i;

/** Whether any of a posting's places is in the United States. A bare "Remote" is unknown. */
export function countryOf(location: string, countryCode: string | null): Country {
  const code = (countryCode ?? "").trim().toUpperCase();
  if (code === "US" || code === "USA" || code === "UNITED STATES") return "US";
  let sawOther = code.length > 0;
  for (const part of location.split(/;|\||\bor\b|\//)) {
    if (!part.trim()) continue;
    if (NON_US_MARK.test(part)) { sawOther = true; continue; }
    if (US_MARK.test(part)) return "US";
  }
  return sawOther ? "other" : "unknown";
}

export function employmentTypeOf(field: string | null, title: string): string | null {
  const c = `${field ?? ""} ${title}`.toLowerCase();
  if (/\b(?:intern|internship|co-?op)\b/.test(c)) return "Internship";
  if (/\b(?:part[- ]?time)\b/.test(c)) return "Part-time";
  if (/\b(?:contract|contractor|freelance|temporary|temp|fixed[- ]term)\b/.test(c)) return "Contract";
  if (/\b(?:full[- ]?time|permanent|regular)\b/.test(c)) return "Full-time";
  return null;
}
