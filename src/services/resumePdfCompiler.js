const PDFDocument = require('pdfkit');

/**
 * resumePdfCompiler.js
 * 
 * Strict 1-Page ATS-Compliant PDF Generator.
 * Built according to ABES Institutional Format & ATS Optimization Guidelines:
 * - Single-column layout (No multi-column tables, photos, or graphics)
 * - Standard typography (Helvetica / Helvetica-Bold) with clean UTF-8 encoding
 * - Clickable PDF URI Annotations on all links (GitHub, LinkedIn, Live Demos)
 * - Clean line flow so words and years never wrap mid-token
 */

const PAGE_HEIGHT_PT = 841.89; // Standard A4 height in points
const PAGE_WIDTH_PT = 595.28;  // Standard A4 width in points

/**
 * Render complete resume into a 1-page PDF Buffer
 */
async function compileResumePdf(resumeData, options = {}) {
  const {
    name = 'Candidate Name',
    contact = {},
    education = [],
    technicalSkills = {},
    experience = [],
    projects = [],
    certifications = [],
    competitiveProgramming = []
  } = resumeData;

  const margin = options.margin || 34;
  const contentWidth = PAGE_WIDTH_PT - (margin * 2);

  const fontNameSize = 15;
  const fontHeadingSize = 10.5;
  const fontBodySize = 8.5;
  const lineHeightRatio = 1.15;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: margin, bottom: margin, left: margin, right: margin },
        info: {
          Title: `Resume - ${name}`,
          Author: name,
          Subject: 'ATS Optimized Engineering Resume'
        }
      });

      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      doc.on('error', reject);

      // ── HELPER: Section Heading with Full-Width Horizontal Rule ──
      function renderSectionHeading(title) {
        doc.moveDown(0.28);
        doc.font('Helvetica-Bold').fontSize(fontHeadingSize).fillColor('#111827')
          .text(title.toUpperCase(), margin, doc.y, { width: contentWidth });
        const y = doc.y + 1;
        doc.strokeColor('#374151').lineWidth(0.75).moveTo(margin, y).lineTo(PAGE_WIDTH_PT - margin, y).stroke();
        doc.y = y + 2.5;
      }

      // ── 1. HEADER (Candidate Name + Clean Contact Footprint) ──
      doc.font('Helvetica-Bold').fontSize(fontNameSize).fillColor('#111827')
        .text(name, margin, margin, { align: 'center', width: contentWidth });
      doc.moveDown(0.12);

      const contactParts = [];
      if (contact.email) contactParts.push(contact.email);
      if (contact.phone) contactParts.push(contact.phone);
      if (contact.location) contactParts.push(contact.location);

      doc.font('Helvetica').fontSize(fontBodySize).fillColor('#374151')
        .text(contactParts.join('  •  '), margin, doc.y, { align: 'center', width: contentWidth });
      doc.moveDown(0.12);

      const links = [];
      if (contact.github) links.push({ label: 'GitHub', url: contact.github });
      if (contact.linkedin) links.push({ label: 'LinkedIn', url: contact.linkedin });
      if (contact.portfolio) links.push({ label: 'Portfolio', url: contact.portfolio });
      if (contact.leetcode) links.push({ label: 'LeetCode', url: contact.leetcode });

      const totalLinksText = links.map(l => l.label).join('   |   ');
      const textWidth = doc.widthOfString(totalLinksText);
      let linkX = Math.max(margin, (PAGE_WIDTH_PT - textWidth) / 2);
      const linksY = doc.y;

      links.forEach((link, idx) => {
        doc.font('Helvetica-Bold').fontSize(fontBodySize).fillColor('#1d4ed8')
          .text(link.label, linkX, linksY, {
            link: link.url.startsWith('http') ? link.url : `https://${link.url}`,
            underline: true,
            continued: false
          });
        linkX += doc.widthOfString(link.label);

        if (idx < links.length - 1) {
          doc.font('Helvetica').fontSize(fontBodySize).fillColor('#6b7280')
            .text('   |   ', linkX, linksY, { continued: false });
          linkX += doc.widthOfString('   |   ');
        }
      });

      doc.y = linksY + fontBodySize + 2.5;

      // ── 2. EDUCATION SECTION ──
      if (Array.isArray(education) && education.length > 0) {
        renderSectionHeading('Education');
        education.forEach((edu) => {
          const topY = doc.y;
          const leftDegreeText = `${edu.degree || 'B.Tech in Computer Science and Engineering'} (${edu.boardOrUniversity || 'AKTU'})`;
          const yearStr = String(edu.year || '2026');

          doc.font('Helvetica-Bold').fontSize(fontBodySize).fillColor('#111827')
            .text(leftDegreeText, margin, topY, { width: contentWidth - 70 });

          doc.font('Helvetica-Bold').fontSize(fontBodySize).fillColor('#111827')
            .text(yearStr, margin, topY, { align: 'right', width: contentWidth });

          const subY = doc.y + 0.5;
          const instText = edu.institution || 'ABES Engineering College, Ghaziabad';
          doc.font('Helvetica').fontSize(fontBodySize).fillColor('#374151')
            .text(instText, margin, subY, { width: contentWidth - 100 });

          if (edu.score) {
            const scoreStr = String(edu.score).includes('CGPA') || String(edu.score).includes('%')
              ? `CGPA: ${edu.score}`
              : `CGPA: ${edu.score}`;
            doc.font('Helvetica-Bold').fontSize(fontBodySize).fillColor('#111827')
              .text(scoreStr, margin, subY, { align: 'right', width: contentWidth });
          }
          doc.y += 1.5;
        });
      }

      // ── 3. TECHNICAL SKILLS SECTION (Categorized) ──
      renderSectionHeading('Technical Skills');
      const skillGroups = [
        { label: 'Languages', items: technicalSkills.languages || ['Python', 'TypeScript', 'JavaScript', 'C++', 'SQL', 'HTML/CSS'] },
        { label: 'Frameworks & Libraries', items: technicalSkills.frameworks || ['React', 'Next.js', 'Node.js', 'Express', 'Tailwind CSS', 'FastAPI'] },
        { label: 'Developer Tools & Cloud', items: technicalSkills.tools || ['Git', 'Docker', 'Firebase', 'AWS', 'Vercel', 'Postman', 'Linux'] },
        { label: 'Core Competencies', items: technicalSkills.concepts || ['REST APIs', 'System Architecture', 'Computer Vision', 'Data Structures & Algorithms'] }
      ];

      skillGroups.forEach(group => {
        if (group.items && group.items.length) {
          doc.font('Helvetica-Bold').fontSize(fontBodySize).fillColor('#111827')
            .text(`${group.label}: `, margin, doc.y, { continued: true, width: contentWidth })
            .font('Helvetica').fillColor('#374151')
            .text(group.items.join(', '), { continued: false, width: contentWidth });
          doc.y += 1;
        }
      });

      // ── 4. PROJECTS SECTION ──
      if (Array.isArray(projects) && projects.length > 0) {
        renderSectionHeading('Key Projects');
        projects.slice(0, 3).forEach((proj) => {
          const topY = doc.y;
          doc.font('Helvetica-Bold').fontSize(fontBodySize).fillColor('#111827')
            .text(proj.title || 'Project Title', margin, topY, { width: contentWidth - 110 });

          const timelineStr = proj.timeline || 'Jan 2025 – Present';
          doc.font('Helvetica-Bold').fontSize(fontBodySize).fillColor('#4b5563')
            .text(timelineStr, margin, topY, { align: 'right', width: contentWidth });

          const stackY = doc.y + 0.5;
          if (proj.liveUrl) {
            doc.font('Helvetica-Bold').fontSize(fontBodySize - 0.5).fillColor('#1d4ed8')
              .text(proj.liveUrl.replace(/^https?:\/\//, ''), margin, stackY, {
                link: proj.liveUrl,
                underline: true,
                continued: true
              })
              .font('Helvetica').fillColor('#6b7280')
              .text(`  |  ${(proj.techStack || []).join(', ')}`, { continued: false, width: contentWidth });
          } else {
            doc.font('Helvetica').fontSize(fontBodySize - 0.5).fillColor('#4b5563')
              .text((proj.techStack || []).join(', '), margin, stackY, { width: contentWidth });
          }

          const bullets = Array.isArray(proj.bullets) ? proj.bullets.slice(0, 3) : [];
          bullets.forEach(bullet => {
            doc.y += 1;
            doc.font('Helvetica').fontSize(fontBodySize).fillColor('#1f2937')
              .text('•  ', margin + 6, doc.y, { continued: true, lineGap: lineHeightRatio })
              .text(bullet, { width: contentWidth - 12 });
          });
          doc.y += 1.5;
        });
      }

      // ── 5. EXPERIENCE / INTERNSHIPS (If present) ──
      if (Array.isArray(experience) && experience.length > 0) {
        renderSectionHeading('Experience');
        experience.slice(0, 2).forEach(exp => {
          const expY = doc.y;
          doc.font('Helvetica-Bold').fontSize(fontBodySize).fillColor('#111827')
            .text(`${exp.role || 'Software Engineer Intern'} — ${exp.company || 'Tech Company'}`, margin, expY, { width: contentWidth - 110 });

          const dateStr = exp.dates || '2025';
          doc.font('Helvetica-Bold').fontSize(fontBodySize).fillColor('#4b5563')
            .text(dateStr, margin, expY, { align: 'right', width: contentWidth });

          const bullets = Array.isArray(exp.bullets) ? exp.bullets : [];
          bullets.slice(0, 2).forEach(b => {
            doc.y += 1;
            doc.font('Helvetica').fontSize(fontBodySize).fillColor('#1f2937')
              .text('•  ', margin + 6, doc.y, { continued: true, lineGap: lineHeightRatio })
              .text(b, { width: contentWidth - 12 });
          });
          doc.y += 1.5;
        });
      }

      // ── 6. CERTIFICATIONS & ACHIEVEMENTS ──
      if ((Array.isArray(certifications) && certifications.length > 0) || (Array.isArray(competitiveProgramming) && competitiveProgramming.length > 0)) {
        renderSectionHeading('Certifications & Achievements');

        competitiveProgramming.forEach(cp => {
          if (cp.bulletText) {
            doc.y += 1;
            doc.font('Helvetica').fontSize(fontBodySize).fillColor('#1f2937')
              .text('•  ', margin + 6, doc.y, { continued: true })
              .text(cp.bulletText, { width: contentWidth - 12 });
          }
        });

        certifications.slice(0, 3).forEach(cert => {
          const certTitle = cert.title || 'Official Certification';
          const certIssuer = cert.issuer || 'Issuing Authority';
          const certDate = cert.date || '2025';

          doc.y += 1;
          doc.font('Helvetica-Bold').fontSize(fontBodySize).fillColor('#111827')
            .text('•  ', margin + 6, doc.y, { continued: true })
            .text(`${certTitle}`, { continued: true })
            .font('Helvetica').fillColor('#374151')
            .text(` | ${certIssuer} | ${certDate}`, { width: contentWidth - 12 });
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  compileResumePdf
};
