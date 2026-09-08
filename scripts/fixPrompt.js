/**
 * Fix: Add "PROJECT vs EXPERIENCE CLASSIFICATION" rule to generation prompt.
 * The Falcon Tour (freelancing) must go to experience[], not projects[].
 * 
 * Strategy: Find the exact string markers in the prompt and insert the new
 * rules block between them, then rewrite the custom-instructions block
 * to also include the experience[] instruction.
 */
const fs = require('fs');
const path = require('path');
const fp = path.join(__dirname, '..', 'src', 'services', 'directPdfResumeService.js');

let c = fs.readFileSync(fp, 'utf8');

// ── Patch 1: Insert Rules 1-3 between profile JSON and Rule 4 ──────────────
// The old code had:  ...profile JSON...\n\nCRITICAL RULES:\n1. LINKS...
// We want to keep rule 1 (LINKS), fix rule 2 (classification), keep rule 3.

const OLD_RULE2 = `   - CLASSIFY PERSONAL VS CLIENT WORK: From the candidate's custom instructions/notes decide each project's client field. If the candidate says a project was built as freelancing / for a client / paid service work ("client ke liye banaya", "freelancing me"), set "client": true and phrase its bullets as a client-delivered engagement (business outcome, on-time delivery, stakeholder value). Otherwise keep "client": false (personal portfolio work).`;

const NEW_RULE2 = `   - CLASSIFY PERSONAL vs FREELANCE/CLIENT WORK — CRITICAL ROUTING RULE:
     * FREELANCING / CLIENT WORK → MUST go in "experience" array, NOT "projects" array.
       If the candidate (or their custom instructions) says a project was freelancing, for a client, or paid service work — keywords: "client ke liye banaya", "freelancing me banaya", "service project", "client work" — place it in experience[] as:
         "role": "Freelance Web Developer"  (adjust tech: Freelance Full-Stack / Freelance Frontend etc.)
         "company": "[The client/project name, e.g. The Falcon Tour]"
         "duration": "[Duration if stated, otherwise estimate e.g. 2023 – 2024]"
         "location": "Remote"
         "bullets": [client-delivery framing: deployed for client, business outcome, real users, on-time delivery, revenue/traffic impact]
       Do NOT put this entry in projects[]. Do NOT duplicate it.
     * PERSONAL / PORTFOLIO / HACKATHON → projects[] array only.
       Personal side projects, open-source contributions, hackathon submissions stay in projects[].`;

if (!c.includes(OLD_RULE2)) {
  console.error('ERROR: Could not find Rule 2 text to replace. The file may have already been patched or changed.');
  process.exit(1);
}

c = c.replace(OLD_RULE2, NEW_RULE2);
console.log('✅ Patch 1 applied: Rule 2 updated with experience[] routing.');

// ── Patch 2: Update the HOW TO APPLY THEM section in custom instructions ────
const OLD_APPLY = `   - If the user says a project was freelance / client / paid-service work ("client ke liye", "freelancing me banaya", "service project"), set that project's "client": true and describe it as a client engagement so a recruiter understands it is real professional/client work, not a class assignment.`;

const NEW_APPLY = `   - If the user says a project was freelance / client / paid-service work ("client ke liye", "freelancing me banaya", "service project"), MOVE that project to the experience[] array. Use role="Freelance [Tech] Developer", company=the project/client name, and write bullets as client-delivery outcomes. Do NOT put it in projects[].`;

if (!c.includes(OLD_APPLY)) {
  console.warn('⚠️  Patch 2: Could not find HOW TO APPLY THEM text — skipping (may already be patched).');
} else {
  c = c.replace(OLD_APPLY, NEW_APPLY);
  console.log('✅ Patch 2 applied: HOW TO APPLY THEM updated.');
}

// ── Also update the schema comment for experience[] to be more explicit ─────
const OLD_SCHEMA_EXP = `  "experience": [
    {
      "role": "Role / Position",
      "company": "Company / Organization Name",
      "duration": "Duration",
      "location": "Location",
      "bullets": [
        "Core contribution with measurable outcome"
      ]
    }
  ],`;

const NEW_SCHEMA_EXP = `  "experience": [
    {
      "role": "Freelance Web Developer",
      "company": "The Falcon Tour",
      "duration": "2023 – 2024",
      "location": "Remote",
      "bullets": [
        "Designed and deployed a 210+ page travel website for a live client, covering destinations, packages, and activities"
      ]
    }
  ],
  // NOTE: experience[] is for freelancing/client work. projects[] is for personal/hackathon/portfolio work.`;

if (c.includes(OLD_SCHEMA_EXP)) {
  c = c.replace(OLD_SCHEMA_EXP, NEW_SCHEMA_EXP);
  console.log('✅ Patch 3 applied: experience[] schema example updated with concrete freelancing example.');
} else {
  console.warn('⚠️  Patch 3: Schema example not found — skipping.');
}

fs.writeFileSync(fp, c, 'utf8');
console.log('\nAll patches applied. Running syntax check...');
