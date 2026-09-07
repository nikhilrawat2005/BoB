require('dotenv').config();
const resumeAnalyzer = require('../src/services/resumeAnalyzerService');
const documentReader = require('../src/services/documentReaderService');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('\n=== Testing FIXED auditResume() on Nikhil_Rawat_Resume.pdf ===\n');

  const pdfPath = path.join(__dirname, '..', 'Nikhil_Rawat_Resume.pdf');
  const fileBuffer = fs.readFileSync(pdfPath);
  
  const extraction = await documentReader.extractText(fileBuffer, 'Nikhil_Rawat_Resume.pdf');
  console.log('PDF extraction: OK | chars:', extraction.text.length, '| pages:', extraction.pageCount);
  
  console.log('\nRunning audit (may take 10-20 sec)...\n');
  const audit = await resumeAnalyzer.auditResume({
    resumeText: extraction.text,
    targetJobDescription: ''
  });

  console.log('=== AUDIT RESULT ===');
  console.log('atsScore:', audit.atsScore);
  console.log('verdict:', audit.verdict);
  console.log('\nbreakdown:');
  for (const [k, v] of Object.entries(audit.breakdown || {})) {
    console.log(`  ${k}: ${v}`);
  }
  console.log('\nexecutiveSummary:', audit.executiveSummary);
  console.log('\nstrengths:');
  (audit.strengths || []).forEach((s, i) => console.log(`  ${i+1}. ${s}`));
  console.log('\ncriticalNegatives:');
  (audit.criticalNegatives || []).forEach((n, i) => console.log(`  ${i+1}. ${n}`));
  console.log('\natsKeywordsFound:', (audit.atsKeywordsFound || []).join(', '));
  console.log('\nmissingRecommendedKeywords:', (audit.missingRecommendedKeywords || []).join(', '));
  console.log('\nbulletImprovements (first 2):');
  (audit.bulletImprovements || []).slice(0, 2).forEach((b, i) => {
    console.log(`  [${i+1}] Original: ${b.original.slice(0, 80)}...`);
    console.log(`      Improved: ${b.improved.slice(0, 80)}...`);
  });
  console.log('\nactionPlan:');
  (audit.actionPlan || []).forEach((s, i) => console.log(`  ${i+1}. ${s}`));
}

main().catch(console.error);
