/**
 * Fix: rewrite lines 636-638 in directPdfResumeService.js
 * The regex lines got double-escaped \s in the file due to encoding issues.
 * This script fixes them by replacing those exact lines with clean versions
 * that avoid the backtick-in-regex issue entirely using a simpler approach.
 */
const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'src', 'services', 'directPdfResumeService.js');

let content = fs.readFileSync(filePath, 'utf8');

// Replace the problematic code-fence stripping section.
// The old version tried to embed backticks in regex literals which caused issues.
// New version uses indexOf/slice to strip code fences instead.
const oldSection = content.slice(
  content.indexOf('    const refinedRaw = (refinedResponse'),
  content.indexOf('    if (!refinedMatch) {') + '    if (!refinedMatch) {'.length
);

const newSection = `    const refinedRaw = (refinedResponse && refinedResponse.text) ? refinedResponse.text : String(refinedResponse);
    // Strip markdown code fences (e.g. \`\`\`json ... \`\`\`) if model wraps JSON
    let refinedClean = refinedRaw.trim();
    if (refinedClean.startsWith('\`\`\`')) {
      const firstNewline = refinedClean.indexOf('\\n');
      if (firstNewline !== -1) refinedClean = refinedClean.slice(firstNewline + 1);
      if (refinedClean.endsWith('\`\`\`')) refinedClean = refinedClean.slice(0, refinedClean.lastIndexOf('\`\`\`'));
      refinedClean = refinedClean.trim();
    }
    const refinedMatch = refinedClean.match(/\\{[\\s\\S]*\\}/);
    if (!refinedMatch) {`;

content = content.replace(oldSection, newSection);
fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed code-fence stripping section. Checking result...');

// Verify the lines look right
const lines = content.split('\n');
const idx = lines.findIndex(l => l.includes('refinedClean = refinedClean.trim()'));
for (let i = Math.max(0, idx - 2); i <= Math.min(lines.length - 1, idx + 4); i++) {
  console.log(i + 1, lines[i]);
}
