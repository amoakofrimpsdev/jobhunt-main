// Removes the Authenticode signature from a Windows .exe, as `signtool remove /s` does, so that adding Jobhunt's
// launcher to Node's node.exe leaves an unsigned program rather than one with a broken signature.
//   node scripts/strip-pe-signature.mjs path/to/file.exe
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const b = readFileSync(file);
if (b.toString("latin1", 0, 2) !== "MZ") throw new Error(`${file} is not a Windows program.`);
const pe = b.readUInt32LE(0x3c);
if (b.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error(`${file} has no PE header.`);
const optional = pe + 24;
const magic = b.readUInt16LE(optional);
// The data directories follow the optional header's fixed part: 96 bytes in PE32, 112 in PE32+. The certificate
// table is entry 4, eight bytes each (file offset, size).
const dirs = optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : NaN);
if (Number.isNaN(dirs)) throw new Error("Unknown optional header.");
const entry = dirs + 4 * 8;
const at = b.readUInt32LE(entry), size = b.readUInt32LE(entry + 4);
if (!at || !size) { console.log("No signature."); process.exit(0); }
if (at + size !== b.length) throw new Error("The signature is not at the end of the file; leaving it alone.");
b.writeUInt32LE(0, entry);
b.writeUInt32LE(0, entry + 4);
writeFileSync(file, b.subarray(0, at));
console.log(`Removed a ${size}-byte signature.`);
