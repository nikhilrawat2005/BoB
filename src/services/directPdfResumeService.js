// ---------------------------------------------------------------------------
// Bob Resume Intelligence — Direct PDF Generation Service (PDFKit Engine)
// Builds high-quality, ATS-standard, beautifully formatted single/multi-page
// technical resumes directly inside Node.js without any LaTeX compiler dependency.
// ---------------------------------------------------------------------------
const PDFDocument = require('pdfkit');
const { callLLM } = require('./llmService');

/**
 * Step 1: Use LLM to structure all user data into high-converting ATS JSON
 */
async function generateStructuredResumeData({ profile, jobDescription = '', customInstructions = '' }) {
  const isTargeted = Boolean(jobDescription && jobDescription.trim().length > 20);

  const prompt = `You are a World-Class Technical Career Strategist and Harvard/Google Resume Expert.
Convert the candidate's master profile into a polished, high-impact ATS Technical Resume dataset.

CANDIDATE MASTER PROFILE:
${JSON.stringify(profile, null, 2)}

CRITICAL RULES:
1. LINKS INTEGRITY: ONLY include links that the candidate ACTUALLY has provided in their master profile, smartLinks array, or base resume (e.g. GitHub, LinkedIn, LeetCode, CodeChef, Portfolios). Do NOT hallucinate or insert links if the user has NOT provided them! Ensure link labels are clean and accurate.
2. PROJECT PRESERVATION, CLASSIFICATION & HIRATION BULLETS:
   - The candidate's own named signature projects (BoB, The Falcon Tour, Bloom, Smart Attendance System, Market Kingdom, or any project named in their profile / base resume / notes) MUST all be preserved in the projects array with accurate titles — never drop them, never swap in hallucinated projects. If it is a lot of projects it is fine: this resume is built for high density.
   - CLASSIFY PERSONAL VS CLIENT WORK: From the candidate's custom instructions/notes decide each project's client field. If the candidate says a project was built as freelancing / for a client / paid service work ("client ke liye banaya", "freelancing me"), set "client": true and phrase its bullets as a client-delivered engagement (business outcome, on-time delivery, stakeholder value). Otherwise keep "client": false (personal portfolio work).
   - HIRATION & GOOGLE XYZ FORMULA: Every bullet MUST start with a strong active verb (e.g. Architected, Engineered, Implemented, Spearheaded, Optimized), contain a clear technical task, and end with a quantified metric or measurable outcome (e.g. 'reducing latency by 40%', 'processing 500+ records with 99.2% accuracy', 'generating 210+ static pages').
   - MAXIMIZE ATS KEYWORD COVERAGE: Weave the candidate's actual languages, frameworks, platforms and tools (e.g. React, Node.js, Firebase, Cloudinary, Gemini AI, Next.js, REST APIs, Computer Vision) into project titles, tech stacks and bullets so ATS keyword matching is maximised. Never use a keyword the candidate has not actually used.
   - NO ENDING PERIODS: Do NOT put a period '.' at the end of any bullet point (as per modern ATS / Hiration resume standards).
   - Single focus per bullet: Each bullet must describe one coherent high-impact engineering accomplishment.
3. CUSTOM INSTRUCTIONS (HIGHEST PRIORITY — ALWAYS FOLLOW EXACTLY):
${customInstructions && customInstructions.trim().length > 0 ? `USER'S OWN RESUME NOTES / INSTRUCTIONS:
"""
${customInstructions.trim()}
"""
HOW TO APPLY THEM:
   - If the user says a project was freelance / client / paid-service work ("client ke liye", "freelancing me banaya", "service project"), set that project's "client": true and describe it as a client engagement so a recruiter understands it is real professional/client work, not a class assignment.
   - If the user says "replace X with Y", drop project X and put project Y in exactly that position.
   - If the user says to add something to certifications ("certificates mein dalna"), add it as a certifications entry (action-oriented title + issuer).
   - If the user gives a personal overview / story / context, weave the meaningful parts naturally into the summary and project descriptions without inventing any facts or metrics.
   - These notes OVERRIDE any conflicting default behaviour above.` : `(No custom notes provided — use your best editorial judgement purely from the profile data.)`}
4. CERTIFICATIONS & ACHIEVEMENTS (HIRATION ACTION & METRIC STANDARD):
   - NEVER include 10th/12th marksheets or school grade records here (marksheets belong ONLY under Education).
   - Do NOT just list raw titles like "CodeChef Badge" or "Vibe-2-Vision Participant" without context!
   - Format each certification/achievement into an active, quantifiable accolade:
     • CodeChef: "Awarded CodeChef Problem Solving Milestone (Rating: 1176), solving 30+ algorithmic challenges in Div 3/4 contests" (Issuer: CodeChef)
     • ViCoDathon: "Selected as National Finalist at ViCoDathon 2026, building AI solutions under high-pressure 36-hr hackathon" (Issuer: ABTalks)
     • Vibe-2-Vision: "Awarded Certificate of Innovation at Vibe-2-Vision Hackathon for developing AI-driven social impact workflows" (Issuer: Vibe-2-Vision)
     • AWS: "Completed AWS Academy Graduate — Cloud Foundations, mastering cloud infrastructure, IAM security, and serverless compute" (Issuer: Amazon Web Services)
   - Respect any user request above to also move/duplicate a project into certifications.
5. NO INVENTED CONTACT DETAILS: Use verified email, phone (+91-8700113731), location (Ghaziabad, India).

${isTargeted ? `TARGET JOB VACANCY / JD:
"""
${jobDescription}
"""
TAILORING RULES:
- Align bullet points and skills with high-frequency requirements from this job description.
` : `GENERAL ATS MASTER RULES:
- Maximize ATS parsing by keeping concise, high-density bullet points packed with metrics, tools, and outcomes.
- MAXIMISE ATS KEYWORD COVERAGE: Weave the candidate's real technologies, platforms, and domains across the summary, skills, and bullets (e.g. Node.js, Firebase, Cloudinary, Gemini AI, React, REST APIs, Computer Vision) so that every relevant keyword the candidate actually uses appears somewhere in the document.
`}

RETURN ONLY A VALID JSON OBJECT (no markdown around it, no backticks, no comments, raw JSON only) matching this exact schema:
{
  "basics": {
    "name": "Full Name",
    "title": "Professional Title",
    "email": "Email Address",
    "phone": "Phone Number or empty string",
    "location": "City, Country",
    "links": [
      { "label": "GitHub", "url": "https://github.com/..." }
    ]
  },
  "summary": "2-3 concise lines highlighting technical depth, core stack, and real engineering systems built (without ending period)",
  "skills": {
    "Languages": ["Python", "TypeScript", "JavaScript", "C++"],
    "Frameworks & Libraries": ["Next.js", "React", "Node.js", "Express", "Flask"],
    "Developer Tools & Cloud": ["Firebase", "Cloudinary", "Git", "Vercel", "AWS"],
    "Core Competencies": ["AI/ML Systems", "REST APIs", "System Architecture", "Computer Vision"]
  },
  "projects": [
    {
      "title": "Project Name",
      "techStack": ["Stack items"],
      "link": "https://...",
      "client": false,
      "bullets": [
        "Architected scalable backend reducing response latency by 45% across 10k requests"
      ]
    }
  ],
  "experience": [
    {
      "role": "Role / Position",
      "company": "Company / Organization Name",
      "duration": "Duration",
      "location": "Location",
      "bullets": [
        "Core contribution with measurable outcome"
      ]
    }
  ],
  "codingStats": [
    { "platform": "LeetCode", "highlight": "31 Solved (25 Easy, 6 Medium)" },
    { "platform": "CodeChef", "highlight": "1176 Rating (Div 4 Contender)" }
  ],
  "education": [
    {
      "degree": "Degree",
      "institution": "College / Institution",
      "duration": "Duration",
      "score": "Score / CGPA"
    }
  ],
  "certifications": [
    { "title": "Action-oriented certification achievement", "issuer": "Issuing Org" }
  ]
}`;

  const response = await callLLM({
    messages: [
      { role: 'system', content: 'You are a career expert that outputs strict, valid JSON resumes only.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  });

  const rawText = (response && response.text) ? response.text : String(response);
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse structured resume data from AI');
  }

  const data = JSON.parse(jsonMatch[0]);
  return { data, isTargeted };
}

/**
 * Step 2: Build ATS Jake's / Harvard Standard PDF Buffer using PDFKit
 */
function buildDirectPdfBuffer(resumeData) {
  const layoutFor = (compact) => (compact ? {
    // Compact single-page layout (denser, still clean & recruiter-readable)
    margins: { top: 22, bottom: 22, left: 30, right: 30 },
    name: 17, title: 9.5, contact: 8.5,
    link: 8, linkLineH: 11, section: 10, rule: 0.7,
    summary: 8.8, skillCat: 8.6, skillBody: 8.6, stats: 8.6,
    tLeft: 8.8, tRight: 8, tech: 8, company: 8, bullet: 8.2, cert: 8.2,
    endYStep: 11
  } : {
    // Standard comfortable layout
    margins: { top: 36, bottom: 36, left: 40, right: 40 },
    name: 20, title: 10.5, contact: 9,
    link: 8.5, linkLineH: 12, section: 11, rule: 0.75,
    summary: 9.5, skillCat: 9, skillBody: 9, stats: 9,
    tLeft: 9.5, tRight: 8.5, tech: 8.5, company: 8.5, bullet: 8.8, cert: 8.8,
    endYStep: 12
  });

  const build = (compact) => new Promise((resolve, reject) => {
    try {
      const L = layoutFor(compact);
      const doc = new PDFDocument({
        size: 'A4',
        margins: L.margins,
        bufferPages: true
      });

      let totalPages = 1;
      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve({ buffer: Buffer.concat(buffers), pages: totalPages }));
      doc.on('error', err => reject(err));

      const { basics, summary, skills, projects, experience, codingStats, education, certifications } = resumeData;

      // Color Palette
      const primaryColor = '#111827';   // Dark primary text
      const secondaryColor = '#374151'; // Charcoal body text
      const accentColor = '#1e3a8a';    // Deep ATS Navy for links
      const ruleColor = '#9ca3af';      // Divider line

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const pageBottomLimit = () => doc.page.height - doc.page.margins.bottom;

      // --- Helper: Keep content inside the printable area (adds a page when needed) ---
      function ensureSpace(height) {
        if (doc.y + height > pageBottomLimit()) {
          doc.addPage();
        }
      }

      // --- Helper: Truncate a string with '…' so it never wraps or overlaps ---
      function fitTextWidth(text, fontName, fontSize, maxWidth) {
        doc.font(fontName).fontSize(fontSize);
        let t = String(text || '');
        if (doc.widthOfString(t) <= maxWidth) return t;
        while (t.length > 1 && doc.widthOfString(t) > maxWidth) {
          t = t.slice(0, -1);
        }
        return t.slice(0, -1) + '…';
      }

      if (doc.info) {
        doc.info.Title = basics?.name ? basics.name + ' - Resume' : 'Resume';
        doc.info.Author = basics?.name || 'Bob Resume Builder';
        doc.info.Creator = 'Bob Resume Builder';
      }

      // --- Helper: Draw Section Header with a clean rule ---
      function drawSectionHeader(title) {
        ensureSpace(34);
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold')
           .fontSize(L.section)
           .fillColor(primaryColor)
           .text(title.toUpperCase(), { characterSpacing: 1 });

        const y = doc.y + 2;
        doc.strokeColor(ruleColor)
           .lineWidth(L.rule)
           .moveTo(doc.page.margins.left, y)
           .lineTo(doc.page.margins.left + pageWidth, y)
           .stroke();

        doc.y = y + 4;
        doc.x = doc.page.margins.left;
      }

      // --- Helper: Title row with an optional right-aligned note (cannot overlap) ---
      // Left text wraps inside its reserved width; right text is measured & truncated.
      function drawTitleLine(left, right, rightColor = secondaryColor, rightUrl = null) {
        const y = doc.y;
        let rightText = '';
        let rightWidth = 0;
        if (right) {
          rightText = fitTextWidth(right, 'Helvetica-Oblique', L.tRight, Math.min(210, pageWidth * 0.4));
          rightWidth = doc.widthOfString(rightText);
        }
        const gap = 8;
        const leftWidth = Math.max(90, pageWidth - rightWidth - gap);

        let endY = y + L.endYStep;
        if (left) {
          doc.font('Helvetica-Bold').fontSize(L.tLeft).fillColor(primaryColor);
          doc.text(left, doc.page.margins.left, y, { width: leftWidth, lineGap: 1 });
          endY = doc.y;
        }
        if (rightText) {
          doc.font('Helvetica-Oblique').fontSize(L.tRight).fillColor(rightColor);
          const rightX = doc.page.margins.left + leftWidth + gap;
          doc.text(rightText, rightX, y, { lineBreak: false });
          if (rightUrl) {
            doc.strokeColor(accentColor).lineWidth(0.5).moveTo(rightX, y + L.tRight + 0.8).lineTo(rightX + rightWidth, y + L.tRight + 0.8).stroke();
            doc.link(rightX, y, rightWidth, 11, rightUrl);
          }
          endY = Math.max(endY, doc.y);
        }
        doc.y = endY;
        doc.x = doc.page.margins.left;
      }

      // --- Helper: Bullet point that never exits the printable area ---
      function drawBullet(text) {
        const b = String(text).trim().replace(/\.+$/, '');
        ensureSpace(14);
        doc.x = doc.page.margins.left;
        doc.font('Helvetica').fontSize(L.bullet).fillColor(secondaryColor);
        doc.text(`•  ${b}`, { indent: 10, lineGap: 1.2 });
      }

      // --- Helper: Normalize a link label to a clean, recruiter-friendly name ---
      function normalizeLinkLabel(label, url) {
        const nameMap = {
          leetcode: 'LeetCode',
          codechef: 'CodeChef',
          codeforces: 'Codeforces',
          hackerrank: 'HackerRank',
          geeksforgeeks: 'GeeksforGeeks',
          github: 'GitHub',
          linkedin: 'LinkedIn',
          kaggle: 'Kaggle',
          medium: 'Medium',
          'dev.to': 'DEV.to',
          portfolio: 'Portfolio',
          resume: 'Portfolio',
          blog: 'Blog'
        };
        const l = String(label || '').trim();
        const looksLikeUrl = /^https?:\/\//i.test(l) || /^www\./i.test(l) || /\.(com|to|org|io|me|in)\//i.test(l + '/');
        if (!l || looksLikeUrl) {
          const u = String(url || '').toLowerCase();
          if (u.includes('leetcode.com')) return 'LeetCode';
          if (u.includes('codechef.com')) return 'CodeChef';
          if (u.includes('codeforces.com')) return 'Codeforces';
          if (u.includes('hackerrank.com')) return 'HackerRank';
          if (u.includes('geeksforgeeks.org')) return 'GeeksforGeeks';
          if (u.includes('dev.to')) return 'DEV.to';
          if (u.includes('medium.com')) return 'Medium';
          if (u.includes('github.com')) return 'GitHub';
          if (u.includes('linkedin.com')) return 'LinkedIn';
          if (u.includes('kaggle.com')) return 'Kaggle';
          if (u.includes('blogspot.com') || u.includes('wordpress.com') || u.includes('hashnode.com')) return 'Blog';
          if (u.includes('portfolio') || u.includes('resume')) return 'Portfolio';
          return 'Link';
        }
        if (nameMap[l.toLowerCase()]) return nameMap[l.toLowerCase()];
        return l.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
      }

      // --- Helper: Keep just the bare host path for display ---
      function shortLinkUrl(url) {
        return String(url || '')
          .replace(/^https?:\/\//i, '')
          .replace(/^www\./, '')
          .replace(/\/$/, '');
      }

      // --- Helper: Centered, wrapping row of clickable link segments ---
      function drawCenteredLinks(links) {
        const linkedFont = 'Helvetica';
        const fontSize = L.link;
        const sep = '   |   ';
        const lineH = L.linkLineH;

        doc.font(linkedFont).fontSize(fontSize);
        const sepLen = doc.widthOfString(sep);
        const segs = links.map(l => ({
          text: `${normalizeLinkLabel(l.label, l.url)}: ${shortLinkUrl(l.url)}`,
          url: String(l.url || '').trim()
        }));

        // Pack segments into centered lines that fit the width
        const lines = [];
        let cur = [];
        let curLen = 0;
        segs.forEach(s => {
          const w = doc.widthOfString(s.text);
          const need = (cur.length ? sepLen : 0) + w;
          if (cur.length && curLen + need > pageWidth) {
            lines.push(cur);
            cur = [s];
            curLen = w;
          } else {
            cur.push(s);
            curLen += need;
          }
        });
        if (cur.length) lines.push(cur);

        ensureSpace(lines.length * lineH);
        lines.forEach(line => {
          const totalW = line.reduce((acc, s, i) => acc + (i ? sepLen : 0) + doc.widthOfString(s.text), 0);
          let x = doc.page.margins.left + (pageWidth - totalW) / 2;
          const y = doc.y;
          line.forEach((s, i) => {
            if (i > 0) {
              doc.font(linkedFont).fontSize(fontSize).fillColor('#6b7280');
              doc.text(sep, x, y, { lineBreak: false });
              x += sepLen;
            }
            const w = doc.widthOfString(s.text);
            doc.font(linkedFont).fontSize(fontSize).fillColor(accentColor);
            doc.text(s.text, x, y, { lineBreak: false });
            doc.strokeColor(accentColor).lineWidth(0.5).moveTo(x, y + fontSize + 0.8).lineTo(x + w, y + fontSize + 0.8).stroke();
            doc.link(x, y, w, 11, s.url);
            x += w;
          });
          doc.y = y + lineH;
          doc.x = doc.page.margins.left;
        });
      }

      // --- 1. HEADER / BASICS ---
      const name = basics?.name || 'Full Name';
      ensureSpace(60);
      doc.font('Helvetica-Bold')
         .fontSize(L.name)
         .fillColor(primaryColor)
         .text(name, { align: 'center' });

      if (basics?.title) {
        doc.moveDown(0.15);
        doc.font('Helvetica')
           .fontSize(L.title)
           .fillColor(secondaryColor)
           .text(basics.title, { align: 'center' });
      }

      // Contact info bar
      const contactItems = [];
      if (basics?.email) contactItems.push(basics.email);
      if (basics?.phone) contactItems.push(basics.phone);
      if (basics?.location) contactItems.push(basics.location);

      if (contactItems.length > 0) {
        doc.moveDown(0.15);
        doc.font('Helvetica')
           .fontSize(L.contact)
           .fillColor(secondaryColor)
           .text(contactItems.join('  •  '), { align: 'center' });
      }

      // Profile Links bar (clean labeled, clickable hyperlinks)
      const links = (basics?.links || []).filter(l => l && l.url && String(l.url).trim().length > 0);
      if (links.length > 0) {
        doc.moveDown(0.15);
        drawCenteredLinks(links);
      }

      // --- 2. SUMMARY (If available) ---
      if (summary && summary.trim().length > 10) {
        drawSectionHeader('Summary');
        ensureSpace(45);
        doc.font('Helvetica')
           .fontSize(L.summary)
           .fillColor(secondaryColor)
           .text(summary.trim(), { align: 'justify', lineGap: 1.5 });
      }

      // --- 3. TECHNICAL SKILLS ---
      if (skills && Object.keys(skills).length > 0) {
        drawSectionHeader('Technical Skills');
        for (const [category, items] of Object.entries(skills)) {
          if (!Array.isArray(items) || items.length === 0) continue;
          ensureSpace(14);
          doc.font('Helvetica-Bold')
             .fontSize(L.skillCat)
             .fillColor(primaryColor)
             .text(`${category}: `, { continued: true });
          doc.font('Helvetica')
             .fillColor(secondaryColor)
             .text(items.join(', '));
          doc.moveDown(0.15);
        }
      }

      // --- 4. CODING & PROBLEM SOLVING HIGHLIGHTS ---
      if (Array.isArray(codingStats) && codingStats.length > 0) {
        drawSectionHeader('Competitive Programming & Problem Solving');
        const statsLine = codingStats.map(s => `${s.platform}: ${s.highlight}`).join('   •   ');
        ensureSpace(20);
        doc.font('Helvetica')
           .fontSize(L.stats)
           .fillColor(secondaryColor)
           .text(statsLine, { lineGap: 1 });
      }

      // --- 5. PROJECTS ---
      if (Array.isArray(projects) && projects.length > 0) {
        drawSectionHeader('Projects');
        projects.forEach(p => {
          ensureSpace(16);
          doc.moveDown(0.2);
          const cleanLink = (p.link || '')
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '')
            .replace(/^www\./, '');
          drawTitleLine(p.client ? `${p.title} (Client Project)` : (p.title || 'Project'), cleanLink || null, accentColor, p.link || null);

          if (p.techStack && p.techStack.length > 0) {
            doc.font('Helvetica-Oblique')
               .fontSize(L.tech)
               .fillColor(secondaryColor)
               .text(`| ${p.techStack.join(', ')}`, { indent: 2, lineGap: 1 });
            doc.moveDown(0.1);
          }

          (p.bullets || []).forEach(drawBullet);
        });
      }

      // --- 6. EXPERIENCE (If available) ---
      if (Array.isArray(experience) && experience.length > 0) {
        drawSectionHeader('Experience');
        experience.forEach(exp => {
          ensureSpace(16);
          doc.moveDown(0.2);
          drawTitleLine(exp.role || 'Role', exp.duration || '');

          if (exp.company) {
            doc.font('Helvetica')
               .fontSize(L.company)
               .fillColor(secondaryColor)
               .text(exp.company, { lineGap: 1 });
            doc.moveDown(0.1);
          }

          (exp.bullets || []).forEach(drawBullet);
        });
      }

      // --- 7. EDUCATION ---
      if (Array.isArray(education) && education.length > 0) {
        drawSectionHeader('Education');
        education.forEach(edu => {
          ensureSpace(16);
          doc.moveDown(0.15);
          drawTitleLine(`${edu.degree || 'Degree'}${edu.score ? ` (${edu.score})` : ''}`, edu.duration || '');

          if (edu.institution) {
            doc.font('Helvetica')
               .fontSize(L.company)
               .fillColor(secondaryColor)
               .text(edu.institution, { lineGap: 1 });
          }
        });
      }

      // --- 8. CERTIFICATIONS / DOCUMENTS ---
      if (Array.isArray(certifications) && certifications.length > 0) {
        drawSectionHeader('Certifications & Academics');
        certifications.forEach(c => {
          ensureSpace(13);
          doc.font('Helvetica')
             .fontSize(L.cert)
             .fillColor(secondaryColor)
             .text(`•  ${c.title}${c.issuer ? ` (${c.issuer})` : ''}`, { indent: 10, lineGap: 1 });
        });
      }

      const range = doc.bufferedPageRange();
      if (range && range.count) totalPages = range.count;
      doc.end();
    } catch (err) {
      reject(err);
    }
  });

  // Best-effort compact single-page: if the standard layout overflows to 2+
  // pages, rebuild denser so everything packs into one page.
  return build(false).then(result => {
    if (result.pages <= 1) return result.buffer;
    console.log(`[DirectPdfResume] ${result.pages} pages → rebuilding compact single-page layout`);
    return build(true).then(r => r.buffer);
  });
}

module.exports = {
  generateStructuredResumeData,
  buildDirectPdfBuffer
};
