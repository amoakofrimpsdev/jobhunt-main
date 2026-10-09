// Turns a piece of writing (a tailored resume, a cover letter) into a file to send: a PDF or a Word document. Both
// are written here, byte by byte, with nothing but Node: real selectable text in a standard font, one column, no
// tables or images, which is what applicant-tracking systems read most reliably.
import { deflateRawSync, crc32 } from "node:zlib";
import type { DocumentKind } from "./types";

type Line = { text: string; style: "name" | "contact" | "heading" | "bullet" | "body" | "gap" };

/** Reads the plain text (or light Markdown) of a document into lines with a role each. */
function outline(content: string, kind: DocumentKind): Line[] {
  const raw = content.replace(/\r/g, "").split("\n").map((l) => l.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/\t/g, " ").trimEnd());
  const out: Line[] = [];
  const resume = kind === "resume";
  let seenText = false;
  let inHeader = resume;
  for (const l of raw) {
    const t = l.trim();
    if (!t || /^[-=_*]{3,}$/.test(t)) {
      if (seenText) { inHeader = false; if (out[out.length - 1]?.style !== "gap") out.push({ text: "", style: "gap" }); }
      continue;
    }
    const hash = /^#{1,6}\s+(.*)$/.exec(t);
    const bullet = /^(?:[-*•·▪◦]|\d+[.)])\s+(.*)$/.exec(t);
    const letters = t.replace(/[^A-Za-z]/g, "");
    const caps = resume && letters.length >= 3 && t.length <= 48 && letters === letters.toUpperCase() && !/[.@]/.test(t);
    if (resume && !seenText) out.push({ text: (hash ? hash[1] : t).trim(), style: "name" });
    else if (hash || (caps && !bullet)) { inHeader = false; out.push({ text: (hash ? hash[1] : t).trim(), style: "heading" }); }
    else if (bullet) { inHeader = false; out.push({ text: bullet[1].trim(), style: "bullet" }); }
    else out.push({ text: t, style: inHeader ? "contact" : "body" });
    seenText = true;
  }
  while (out[out.length - 1]?.style === "gap") out.pop();
  return out;
}

// ---------------------------------------------------------------- PDF

// Advance widths of Helvetica and Helvetica-Bold for the characters 32 to 126, in thousandths of the font size.
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// Characters outside Latin-1 that the PDF's standard encoding (WinAnsi) still has, with their byte and width.
const WIN: Record<string, [number, number]> = {
  "•": [0x95, 350], "–": [0x96, 556], "—": [0x97, 1000], "‘": [0x91, 222], "’": [0x92, 222], "“": [0x93, 333], "”": [0x94, 333],
  "…": [0x85, 1000], "€": [0x80, 556], "™": [0x99, 1000], "·": [0xb7, 278], "▪": [0x95, 350], "◦": [0x95, 350], "−": [0x2d, 333], " ": [0x20, 278],
};

function encode(s: string, bold: boolean): { bytes: number[]; width: number } {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  const bytes: number[] = [];
  let width = 0;
  for (const ch of s.normalize("NFC")) {
    const code = ch.codePointAt(0) ?? 63;
    if (code >= 32 && code <= 126) { bytes.push(code); width += table[code - 32]; }
    else if (WIN[ch]) { bytes.push(WIN[ch][0]); width += WIN[ch][1]; }
    else if (code >= 0xa1 && code <= 0xff) { bytes.push(code); width += 556; }
    else { bytes.push(63); width += 556; }
  }
  return { bytes, width };
}

const literal = (bytes: number[]) => `(${bytes.map((b) => (b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : b < 127 ? String.fromCharCode(b) : `\\${b.toString(8)}`)).join("")})`;

function wrap(text: string, bold: boolean, size: number, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && (encode(next, bold).width * size) / 1000 > max) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** A PDF of the document on US Letter pages. */
export function toPdf(content: string, kind: DocumentKind, title: string): Buffer {
  const W = 612, H = 792, M = 58;
  const body = kind === "resume" ? 10.5 : 11.5;
  const pages: string[][] = [[]];
  let y = H - M;
  const page = () => pages[pages.length - 1];
  const need = (h: number) => { if (y - h < M) { pages.push([]); y = H - M; } };
  const put = (s: string, x: number, size: number, bold: boolean) => page().push(`BT /F${bold ? 2 : 1} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${literal(encode(s, bold).bytes)} Tj ET`);
  const block = (t: string, size: number, bold: boolean, indent: number, lead: number, center = false, bullet = false) => {
    const lines = wrap(t, bold, size, W - 2 * M - indent);
    lines.forEach((line, i) => {
      need(lead);
      y -= lead;
      if (bullet && i === 0) put("•", M + indent - 11, size, false);
      put(line, center ? (W - (encode(line, bold).width * size) / 1000) / 2 : M + indent, size, bold);
    });
  };
  for (const l of outline(content, kind)) {
    if (l.style === "gap") y -= kind === "resume" ? 5 : 9;
    else if (l.style === "name") block(l.text, 20, true, 0, 22, true);
    else if (l.style === "contact") block(l.text, 10, false, 0, 13.5, true);
    else if (l.style === "heading") {
      need(34);
      y -= 7;
      block(l.text, 11.5, true, 0, 15);
      y -= 3.5;
      page().push(`0.6 w 0.2 G ${M} ${y.toFixed(2)} m ${W - M} ${y.toFixed(2)} l S`);
      y -= 1.5;
    }
    else if (l.style === "bullet") block(l.text, body, false, 13, body * 1.36, false, true);
    else block(l.text, body, false, 0, body * 1.36);
  }

  // Objects: 1 catalog, 2 page tree, 3 and 4 the fonts, 5 the document's details, then a page and its content each.
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${6 + i * 2} 0 R`).join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = `<< /Title ${literal(encode(title, false).bytes)} /Producer (Jobhunt) >>`;
  pages.forEach((ops, i) => {
    const stream = ops.join("\n");
    objects[6 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + i * 2} 0 R >>`;
    objects[7 + i * 2] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ---------------------------------------------------------------- Word (.docx)

function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = deflateRawSync(f.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(0x00210000, 10); head.writeUInt32LE(crc32(f.data) >>> 0, 14); head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(f.data.length, 22); head.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); head.copy(entry, 8, 6, 30);
    entry.writeUInt32LE(offset, 42);
    parts.push(head, name, packed);
    central.push(entry, name);
    offset += 30 + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A Word document of the same content. */
export function toDocx(content: string, kind: DocumentKind, title: string): Buffer {
  const font = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>';
  const run = (t: string, half: number, bold = false) => `<w:r><w:rPr>${font}${bold ? "<w:b/>" : ""}<w:sz w:val="${half}"/><w:szCs w:val="${half}"/></w:rPr><w:t xml:space="preserve">${xml(t)}</w:t></w:r>`;
  const para = (props: string, runs: string) => `<w:p><w:pPr>${props}</w:pPr>${runs}</w:p>`;
  const body = kind === "resume" ? 21 : 23;
  const paragraphs = outline(content, kind).map((l) => {
    switch (l.style) {
      case "gap": return kind === "resume" ? "" : para('<w:spacing w:after="0"/>', "");
      case "name": return para('<w:jc w:val="center"/><w:spacing w:after="40"/>', run(l.text, 40, true));
      case "contact": return para('<w:jc w:val="center"/><w:spacing w:after="0"/>', run(l.text, 20));
      case "heading": return para('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="333333"/></w:pBdr><w:spacing w:before="220" w:after="80"/>', run(l.text, 23, true));
      case "bullet": return para('<w:tabs><w:tab w:val="left" w:pos="260"/></w:tabs><w:ind w:left="260" w:hanging="260"/><w:spacing w:after="30"/>', run(`•\t${l.text}`, body));
      default: return para(`<w:spacing w:after="${kind === "resume" ? 40 : 120}"/>`, run(l.text, body));
    }
  }).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1160" w:right="1160" w:bottom="1160" w:left="1160" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title></cp:coreProperties>`;
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>') },
    { name: "_rels/.rels", data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>') },
    { name: "word/document.xml", data: Buffer.from(document, "utf8") },
    { name: "docProps/core.xml", data: Buffer.from(core, "utf8") },
  ]);
}
