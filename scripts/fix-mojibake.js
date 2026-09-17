// Fix UTF-8 mojibake: file was double-encoded by PowerShell (UTF-8 bytes → CP1252 chars → UTF-8)
// Algorithm: read as UTF-8 string, re-encode each char to CP1252 byte, then decode bytes as UTF-8.
const fs = require('fs');
const TARGET = __dirname + '/../src/services/directPdfResumeService.js';

// CP1252 byte → Unicode mapping (bytes 0x80–0x9F have special codepoints in CP1252)
const CP1252_TO_UNICODE = [
  0x20AC,0x0081,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,
  0x02C6,0x2030,0x0160,0x2039,0x0152,0x008D,0x017D,0x008F,
  0x0090,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,
  0x02DC,0x2122,0x0161,0x203A,0x0153,0x009D,0x017E,0x0178
];

// Reverse: Unicode codepoint → CP1252 byte (only for chars where CP1252 ≠ Unicode)
const UNICODE_TO_CP1252 = new Map();
for (let i = 0; i < CP1252_TO_UNICODE.length; i++) {
  UNICODE_TO_CP1252.set(CP1252_TO_UNICODE[i], 0x80 + i);
}

function fixMojibake(str) {
  // Convert each character back to the CP1252 byte it was wrongly mapped from,
  // then decode the byte sequence as UTF-8.
  const bytes = [];
  let i = 0;
  while (i < str.length) {
    const cp = str.charCodeAt(i);
    // High surrogates
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < str.length) {
      const low = str.charCodeAt(i + 1);
      const fullCp = (cp - 0xD800) * 0x400 + (low - 0xDC00) + 0x10000;
      // Encode supplementary as 4 UTF-8 bytes
      bytes.push(0xF0 | (fullCp >> 18), 0x80 | ((fullCp >> 12) & 0x3F), 0x80 | ((fullCp >> 6) & 0x3F), 0x80 | (fullCp & 0x3F));
      i += 2;
      continue;
    }
    // If this char is in the CP1252 special range (0x80-0x9F as Unicode codepoints),
    // it means the original UTF-8 byte was 0x80-0x9F (after CP1252→Unicode mapping)
    const byteVal = UNICODE_TO_CP1252.get(cp);
    if (byteVal !== undefined) {
      bytes.push(byteVal);
    } else if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp >= 0x80 && cp <= 0xFF) {
      bytes.push(cp); // Latin-1 range, same as Unicode
    } else {
      // Proper Unicode char (>0xFF) that wasn't corrupted — encode as UTF-8
      if (cp < 0x800) bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
      else bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    }
    i++;
  }
  return Buffer.from(bytes).toString('utf8');
}

const raw = fs.readFileSync(TARGET, 'utf8');
const fixed = fixMojibake(raw);

if (raw !== fixed) {
  fs.writeFileSync(TARGET, fixed, 'utf8');
  // Count how many multi-byte sequences were fixed (chars > 0xFF in original that aren't in fixed)
  const origNonAscii = [...raw].filter(c => c.charCodeAt(0) > 0x7F).length;
  const fixedNonAscii = [...fixed].filter(c => c.charCodeAt(0) > 0x7F).length;
  console.log(`Mojibake repaired: ${origNonAscii} non-ASCII chars in → ${fixedNonAscii} clean chars out`);
} else {
  console.log('File already clean.');
}
