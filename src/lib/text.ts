// Posting text helpers: entity decoding, HTML to plain text, and the allowlist that makes a posting safe to render.

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·", trade: "™", reg: "®", copy: "©", eacute: "é",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Greenhouse sends its HTML entity-encoded ("&lt;p&gt;"); other boards send real tags. */
export function unescapeIfEncoded(html: string): string {
  return /&lt;\/?[a-z][^&]*&gt;/i.test(html) && !/<[a-z][^>]*>/i.test(html) ? decodeEntities(html) : html;
}

const BLOCK = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|blockquote)\b[^>]*>/gi;

export function htmlToText(html: string): string {
  const s = unescapeIfEncoded(html ?? "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(BLOCK, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(s).replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const ALLOWED = new Set(["p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "u", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"]);

/**
 * A posting's HTML reduced to plain structure: allowlisted tags with every attribute removed, everything else
 * dropped. The output is what the job page renders, so nothing a board sends can carry a script, style or link.
 */
export function sanitizeHtml(html: string): string {
  const src = unescapeIfEncoded(html ?? "").replace(/<(script|style|iframe|object|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, "");
  let out = "";
  let last = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  const text = (t: string) => t.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out += text(src.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[2].toLowerCase();
    if (tag === "div" || tag === "section") { out += m[1] ? "</p>" : "<p>"; continue; }
    if (!ALLOWED.has(tag)) continue;
    out += tag === "br" ? "<br>" : `<${m[1]}${tag}>`;
  }
  out += text(src.slice(last));
  return out.replace(/<p>\s*<\/p>/g, "").replace(/(?:<br>\s*){3,}/g, "<br><br>").trim();
}

/** The words around a hit, cut at word boundaries. */
export function snippet(text: string, start: number, end: number, max = 220): string {
  const pad = Math.max(0, Math.floor((max - (end - start)) / 2));
  let a = Math.max(0, start - pad), b = Math.min(text.length, end + pad);
  const nl = text.lastIndexOf("\n", start);
  if (nl >= a) a = nl + 1;
  const nl2 = text.indexOf("\n", end);
  if (nl2 !== -1 && nl2 < b) b = nl2;
  let s = text.slice(a, b).trim();
  if (a > 0 && nl < a - 1) s = `…${s.replace(/^\S*\s/, "")}`;
  if (b < text.length && nl2 !== b) s = `${s.replace(/\s\S*$/, "")}…`;
  return s;
}
