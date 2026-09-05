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
async function generateStructuredResumeData({ profile, jobDescription = '' }) {
  const isTargeted = Boolean(jobDescription && jobDescription.trim().length > 20);

  const prompt = `You are a World-Class Technical Career Strategist and Harvard/Google Resume Expert.
Convert the candidate's master profile into a polished, high-impact ATS Technical Resume dataset.

CANDIDATE MASTER PROFILE:
${JSON.stringify(profile, null, 2)}

CRITICAL RULES:
1. LINKS INTEGRITY: ONLY include links that the candidate ACTUALLY has provided in their master profile or base resume (e.g. GitHub, LinkedIn, LeetCode, CodeChef). Do NOT hallucinate or insert links like Codeforces or Portfolio if the user has NOT provided them!
2. PROJECT SELECTION: Look through ALL 11+ repositories in githubProjects (including BoB, The-Falcon-Tour, Bloom / origin-v2v, Smart-Attendance-System, Market-Kingdom). BoB (Autonomous AI Assistant) and The-Falcon-Tour (210+ static pages travel platform) are flagship engineering achievements — evaluate and include them alongside the strongest work!
3. CERTIFICATIONS & ACHIEVEMENTS: Inspect the profile.certifications list (e.g. ABTalks-ViCoDathon, CodeChefBadge, VIBE-2-VISION) AND any baseResume achievements (e.g. AWS Academy Graduate). ALWAYS include a "certifications" array with these real verified items.
4. HONEST & GROUNDED: Never invent tools, links, or metrics the user never provided.

${isTargeted ? `TARGET JOB VACANCY / JD:
"""
${jobDescription}
"""
TAILORING RULES:
- Tailor bullet points and select projects matching this JD using the Google STAR/XYZ formula.
` : `GENERAL ATS MASTER RULES:
- Select 4 top showcase projects showing breadth: AI / Autonomous systems (BoB), Large web architectures (The Falcon Tour), Full-Stack products (Bloom), or Computer Vision (Smart Attendance).
- Frame bullet points with technical rigor: "Accomplished [X] as measured by [Y], by doing [Z]".
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
  "summary": "2-3 concise lines highlighting technical depth and real systems built.",
  "skills": {
    "Languages": ["Python", "TypeScript", "JavaScript", "C++"],
    "Frameworks & Libraries": ["Next.js", "React", "Node.js", "Express", "Flask"],
    "Developer Tools & Cloud": ["Firebase", "Cloudinary", "Git", "Vercel", "AWS"],
    "Core Competencies": ["AI/ML Systems", "REST APIs", "System Architecture"]
  },
  "projects": [
    {
      "title": "Project Name",
      "techStack": ["Stack items"],
      "link": "https://...",
      "bullets": [
        "Engineering outcome and design..."
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
        "Core contributions..."
      ]
    }
  ],
  "codingStats": [
    { "platform": "LeetCode", "highlight": "Stats" }
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
    { "title": "Real Certification Title", "issuer": "Issuing Org" }
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
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 36, bottom: 36, left: 40, right: 40 },
        bufferPages: true
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', err => reject(err));

      const { basics, summary, skills, projects, experience, codingStats, education, certifications } = resumeData;

      // Color Palette
      const primaryColor = '#111827';   // Dark primary text
      const secondaryColor = '#374151'; // Charcoal body text
      const accentColor = '#1e3a8a';    // Deep ATS Navy for links
      const ruleColor = '#9ca3af';      // Divider line

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // --- Helper: Draw Section Header ---
      function drawSectionHeader(title) {
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold')
           .fontSize(11)
           .fillColor(primaryColor)
           .text(title.toUpperCase(), { characterSpacing: 1 });
        
        const y = doc.y + 2;
        doc.strokeColor(ruleColor)
           .lineWidth(0.75)
           .moveTo(doc.page.margins.left, y)
           .lineTo(doc.page.margins.left + pageWidth, y)
           .stroke();
        
        doc.y = y + 4;
      }

      // --- 1. HEADER / BASICS ---
      const name = basics?.name || 'Full Name';
      doc.font('Helvetica-Bold')
         .fontSize(20)
         .fillColor(primaryColor)
         .text(name, { align: 'center' });

      if (basics?.title) {
        doc.moveDown(0.15);
        doc.font('Helvetica')
           .fontSize(10.5)
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
           .fontSize(9)
           .fillColor(secondaryColor)
           .text(contactItems.join('  •  '), { align: 'center' });
      }

      // Profile Links bar
      const links = (basics?.links || []).filter(l => l && l.label && l.url);
      if (links.length > 0) {
        doc.moveDown(0.15);
        const linkParts = links.map(l => `${l.label}: ${l.url.replace(/^https?:\/\//, '')}`);
        doc.font('Helvetica')
           .fontSize(8.5)
           .fillColor(accentColor)
           .text(linkParts.join('  |  '), { align: 'center' });
      }

      // --- 2. SUMMARY (If available) ---
      if (summary && summary.trim().length > 10) {
        drawSectionHeader('Summary');
        doc.font('Helvetica')
           .fontSize(9.5)
           .fillColor(secondaryColor)
           .text(summary.trim(), { align: 'justify', lineGap: 1.5 });
      }

      // --- 3. TECHNICAL SKILLS ---
      if (skills && Object.keys(skills).length > 0) {
        drawSectionHeader('Technical Skills');
        for (const [category, items] of Object.entries(skills)) {
          if (!Array.isArray(items) || items.length === 0) continue;
          doc.font('Helvetica-Bold')
             .fontSize(9)
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
        doc.font('Helvetica')
           .fontSize(9)
           .fillColor(secondaryColor)
           .text(statsLine);
      }

      // --- 5. PROJECTS ---
      if (Array.isArray(projects) && projects.length > 0) {
        drawSectionHeader('Projects');
        projects.forEach(p => {
          doc.moveDown(0.2);
          const startY = doc.y;

          // Project Name & Stack (Left)
          doc.font('Helvetica-Bold')
             .fontSize(9.5)
             .fillColor(primaryColor)
             .text(p.title || 'Project', { continued: true });

          if (p.techStack && p.techStack.length > 0) {
            doc.font('Helvetica-Oblique')
               .fillColor(secondaryColor)
               .text(` | ${p.techStack.join(', ')}`);
          } else {
            doc.text('');
          }

          // Link (Right aligned if available)
          if (p.link) {
            const cleanLink = p.link.replace(/^https?:\/\//, '');
            doc.font('Helvetica')
               .fontSize(8.5)
               .fillColor(accentColor)
               .text(cleanLink, doc.page.margins.left, startY, { align: 'right', width: pageWidth });
          }

          // Bullet points
          (p.bullets || []).forEach(b => {
            doc.font('Helvetica')
               .fontSize(8.8)
               .fillColor(secondaryColor)
               .text(`•  ${b}`, { indent: 10, lineGap: 1.2 });
          });
        });
      }

      // --- 6. EXPERIENCE (If available) ---
      if (Array.isArray(experience) && experience.length > 0) {
        drawSectionHeader('Experience');
        experience.forEach(exp => {
          doc.moveDown(0.2);
          const startY = doc.y;

          doc.font('Helvetica-Bold')
             .fontSize(9.5)
             .fillColor(primaryColor)
             .text(exp.role || 'Role', { continued: true });

          if (exp.company) {
            doc.font('Helvetica')
               .fillColor(secondaryColor)
               .text(` — ${exp.company}`);
          } else {
            doc.text('');
          }

          if (exp.duration) {
            doc.font('Helvetica-Oblique')
               .fontSize(8.5)
               .fillColor(secondaryColor)
               .text(exp.duration, doc.page.margins.left, startY, { align: 'right', width: pageWidth });
          }

          (exp.bullets || []).forEach(b => {
            doc.font('Helvetica')
               .fontSize(8.8)
               .fillColor(secondaryColor)
               .text(`•  ${b}`, { indent: 10, lineGap: 1.2 });
          });
        });
      }

      // --- 7. EDUCATION ---
      if (Array.isArray(education) && education.length > 0) {
        drawSectionHeader('Education');
        education.forEach(edu => {
          doc.moveDown(0.15);
          const startY = doc.y;

          doc.font('Helvetica-Bold')
             .fontSize(9)
             .fillColor(primaryColor)
             .text(edu.degree || 'Degree', { continued: true });

          if (edu.score) {
            doc.font('Helvetica')
               .fillColor(secondaryColor)
               .text(` (${edu.score})`);
          } else {
            doc.text('');
          }

          if (edu.duration) {
            doc.font('Helvetica-Oblique')
               .fontSize(8.5)
               .fillColor(secondaryColor)
               .text(edu.duration, doc.page.margins.left, startY, { align: 'right', width: pageWidth });
          }

          if (edu.institution) {
            doc.font('Helvetica')
               .fontSize(8.5)
               .fillColor(secondaryColor)
               .text(edu.institution);
          }
        });
      }

      // --- 8. CERTIFICATIONS / DOCUMENTS ---
      if (Array.isArray(certifications) && certifications.length > 0) {
        drawSectionHeader('Certifications & Academics');
        certifications.forEach(c => {
          doc.font('Helvetica')
             .fontSize(8.8)
             .fillColor(secondaryColor)
             .text(`•  ${c.title}${c.issuer ? ` (${c.issuer})` : ''}`, { indent: 10 });
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateStructuredResumeData,
  buildDirectPdfBuffer
};
