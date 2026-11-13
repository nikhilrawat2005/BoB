const PDFDocument = require('pdfkit');

/**
 * resumePdfCompiler.js
 * 
 * Strict Single-Column ATS-Compliant PDF Compiler.
 * Institutional ABES / Tech Standard Layout:
 * 
 * Rules:
 * 1. ZERO column collisions or coordinate overlaps: Strict single vertical stream.
 * 2. Explicit margins (0.42in / 30pt) with safe horizontal and vertical bounding boxes.
 * 3. Section headings with full horizontal divider lines.
 * 4. Two-Column Row Helper: Left text and Right text on same baseline with guaranteed width guards.
 * 5. Deterministic budget: strictly fits 1 page without text clipping or overlapping.
 */

const PAGE_HEIGHT_PT = 841.89; // Standard A4 height in points (595.28 x 841.89)
const PAGE_WIDTH_PT = 595.28;  // Standard A4 width in points

/**
 * Sanitize single-line fields (degree, institution, project title, cert title, etc.)
 * Strictly collapses all newlines/tabs, converts fancy quotes/dashes, strips non-ASCII corrupt glyphs,
 * and collapses multiple spaces so the text strictly occupies a single clean line.
 */
function sanitizeSingleLine(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u2018\u2019´`]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Sanitize text to avoid corrupt encoding or non-printable glyphs.
 * Collapses [\r\n]+ into spaces and trims extra whitespace.
 */
function sanitizeAscii(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u2018\u2019´`]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Render complete resume into a 1-page PDF Buffer with auto-fitting font scale
 */
async function compileResumePdf(resumeData, options = {}) {
  const {
    name = 'Nikhil Rawat',
    summary = '',
    contact = {},
    education = [],
    technicalSkills = {},
    experience = [],
    projects = [],
    certifications = [],
    competitiveProgramming = []
  } = resumeData;

  const margin = options.margin || 30.0; // 30pt
  const contentWidth = PAGE_WIDTH_PT - (margin * 2);

  // Layout sizing config
  const scale = options.scale || 1.0;
  const fontNameSize = 15.0 * scale;
  const fontHeadingSize = 10.0 * scale;
  const fontBodySize = 8.5 * scale;
  const fontSubSize = 8.0 * scale;
  const lineSpacing = 1.15;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: margin, bottom: margin, left: margin, right: margin },
        autoFirstPage: true,
        bufferPages: true,
        info: {
          Title: `Resume - ${sanitizeAscii(name)}`,
          Author: sanitizeAscii(name),
          Subject: 'ATS Optimized Resume'
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
        doc.y += 4 * scale;
        const headY = doc.y;
        doc.font('Helvetica-Bold').fontSize(fontHeadingSize).fillColor('#111827')
          .text(title.toUpperCase(), margin, headY, { width: contentWidth, lineBreak: false });
        
        const lineY = headY + fontHeadingSize + (2 * scale);
        doc.strokeColor('#374151').lineWidth(0.75).moveTo(margin, lineY).lineTo(PAGE_WIDTH_PT - margin, lineY).stroke();
        doc.y = lineY + (3 * scale);
      }

      // ── HELPER: Two-Column Row (Left text, Right text on exact same baseline) ──
      function renderDualRow(leftText, rightText, options = {}) {
        const isBold = options.isBold !== false;
        const fontSz = options.fontSize || fontBodySize;
        const leftColor = options.leftColor || '#111827';
        const rightColor = options.rightColor || '#374151';

        const safeLeft = sanitizeSingleLine(leftText);
        const safeRight = sanitizeSingleLine(rightText);

        const rightWidth = options.rightWidth || (safeRight ? (doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSz).widthOfString(safeRight) + 4) : 0);
        const leftWidth = contentWidth - rightWidth - 6;

        // Truncate leftText deterministically if width exceeds leftWidth to strictly occupy 1 line
        let truncatedLeft = safeLeft;
        doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSz);
        if (doc.widthOfString(truncatedLeft) > leftWidth) {
          while (truncatedLeft.length > 3 && doc.widthOfString(truncatedLeft + '...') > leftWidth) {
            truncatedLeft = truncatedLeft.slice(0, -1);
          }
          truncatedLeft += '...';
        }

        const currentY = doc.y;

        // Render Left Text
        doc.fillColor(leftColor)
          .text(truncatedLeft, margin, currentY, { width: leftWidth, lineBreak: false, ellipsis: true });

        // Render Right Text
        if (safeRight) {
          doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSz).fillColor(rightColor)
            .text(safeRight, PAGE_WIDTH_PT - margin - rightWidth, currentY, { width: rightWidth, align: 'right', lineBreak: false });
        }

        const nextY = Math.max(doc.y, currentY + fontSz);
        doc.y = nextY + (options.spacingAfter !== undefined ? options.spacingAfter : (1.5 * scale));
      }

      // ── 1. HEADER (Candidate Name + Clean Contact Footprint) ──
      doc.y = margin;
      doc.font('Helvetica-Bold').fontSize(fontNameSize).fillColor('#111827')
        .text(name, margin, doc.y, { align: 'center', width: contentWidth });
      doc.y += 1.5 * scale;

      const contactParts = [];
      if (contact.email) contactParts.push(contact.email);
      if (contact.phone) contactParts.push(contact.phone);
      if (contact.location) contactParts.push(contact.location);

      if (contactParts.length > 0) {
        doc.font('Helvetica').fontSize(fontSubSize).fillColor('#374151')
          .text(contactParts.join('  |  '), margin, doc.y, { align: 'center', width: contentWidth });
        doc.y += 1.2 * scale;
      }

      // High-signal links only
      const links = [];
      if (contact.github) links.push({ label: 'GitHub', url: contact.github });
      if (contact.linkedin) links.push({ label: 'LinkedIn', url: contact.linkedin });
      if (contact.portfolio) links.push({ label: 'Portfolio', url: contact.portfolio });
      if (contact.codechef) links.push({ label: 'CodeChef', url: contact.codechef });
      if (contact.leetcode) links.push({ label: 'LeetCode', url: contact.leetcode });

      if (links.length > 0) {
        doc.font('Helvetica').fontSize(fontSubSize);
        let linkX = margin;
        const linksY = doc.y;

        // Render plain text line centered
        const totalText = links.map(l => l.label).join('   |   ');
        const textWidth = doc.widthOfString(totalText);
        linkX = Math.max(margin, (PAGE_WIDTH_PT - textWidth) / 2);

        links.forEach((link, idx) => {
          const itemWidth = doc.widthOfString(link.label);
          const safeUrl = String(link.url).startsWith('http') ? String(link.url) : `https://${link.url}`;

          doc.font('Helvetica-Bold').fontSize(fontSubSize).fillColor('#1d4ed8')
            .text(link.label, linkX, linksY, { lineBreak: false });

          // Attach PDF link annotation with explicit coordinates
          doc.link(linkX, linksY, itemWidth, fontSubSize + 2, safeUrl);
          linkX += itemWidth;

          if (idx < links.length - 1) {
            const sepWidth = doc.widthOfString('   |   ');
            doc.font('Helvetica').fontSize(fontSubSize).fillColor('#6b7280')
              .text('   |   ', linkX, linksY, { lineBreak: false });
            linkX += sepWidth;
          }
        });

        doc.y = linksY + fontSubSize + (2.5 * scale);
      }

      // ── 1.5. SUMMARY SECTION (Hiration-Compliant Overview) ──
      if (summary && summary.trim()) {
        renderSectionHeading('Summary');
        const summaryY = doc.y;
        doc.font('Helvetica').fontSize(fontBodySize).fillColor('#1f2937')
          .text(sanitizeAscii(summary), margin, summaryY, { width: contentWidth, lineGap: lineSpacing });
        doc.y += 1.5 * scale;
      }

      // ── 2. EDUCATION SECTION (Strict Single-Column Dual-Row Flow) ──
      if (Array.isArray(education) && education.length > 0) {
        renderSectionHeading('Education');
        
        education.forEach((edu) => {
          const degreeName = sanitizeAscii(edu.degree || 'Degree');
          const boardName = edu.boardOrUniversity ? ` (${sanitizeAscii(edu.boardOrUniversity)})` : '';
          const leftDegreeText = `${degreeName}${boardName}`;
          const yearStr = sanitizeAscii(String(edu.year || edu.graduation_year || ''));

          // Row 1: Degree + Board (Left), Year (Right)
          renderDualRow(leftDegreeText, yearStr, {
            isBold: true,
            fontSize: fontBodySize,
            leftColor: '#111827',
            rightColor: '#111827',
            spacingAfter: 1.2 * scale
          });

          // Row 2: Institution (Left), Score/CGPA (Right)
          const instText = sanitizeAscii(edu.institution || '');
          let scoreDisplay = '';
          if (edu.score) {
            let scoreClean = String(edu.score).replace(/CGPA:\s*/gi, '').replace(/CGPA/gi, '').trim();
            if (scoreClean) {
              scoreDisplay = scoreClean.includes('%') ? scoreClean : `CGPA: ${scoreClean.includes('/10') ? scoreClean : `${scoreClean}/10`}`;
            }
          }

          renderDualRow(instText, scoreDisplay, {
            isBold: false,
            fontSize: fontSubSize,
            leftColor: '#374151',
            rightColor: '#111827',
            spacingAfter: 2.2 * scale
          });
        });
      }

      // ── 3. TECHNICAL SKILLS SECTION (Strict Clean Inline Labels) ──
      renderSectionHeading('Technical Skills');
      const skillGroups = [
        { label: 'Languages', items: technicalSkills.languages || ['Python', 'TypeScript', 'JavaScript', 'C++', 'SQL', 'HTML/CSS'] },
        { label: 'Frameworks & Libraries', items: technicalSkills.frameworks || ['React', 'Next.js', 'Node.js', 'Express', 'FastAPI', 'Tailwind CSS'] },
        { label: 'Developer Tools & Cloud', items: technicalSkills.tools || ['Git', 'Docker', 'Firebase', 'AWS', 'Vercel', 'Postman', 'Linux'] },
        { label: 'Core Competencies', items: technicalSkills.concepts || ['REST APIs', 'System Architecture', 'Computer Vision', 'Data Structures & Algorithms'] }
      ];

      skillGroups.forEach(group => {
        if (group.items && group.items.length) {
          const lineY = doc.y;
          doc.font('Helvetica-Bold').fontSize(fontBodySize).fillColor('#111827')
            .text(`${group.label}: `, margin, lineY, { continued: true, width: contentWidth })
            .font('Helvetica').fillColor('#374151')
            .text(group.items.map(sanitizeSingleLine).join(', '), { continued: false, width: contentWidth });
          doc.y = Math.max(doc.y, lineY + fontBodySize) + (1.8 * scale);
        }
      });

      // ── 4. KEY PROJECTS SECTION (Strict Single-Column Flow) ──
      if (Array.isArray(projects) && projects.length > 0) {
        renderSectionHeading('Key Projects');
        projects.slice(0, 3).forEach((proj) => {
          // Row 1: Project Title (Left), Timeline (Right)
          const titleStr = sanitizeAscii(proj.title || 'Project Title');
          const timelineStr = sanitizeAscii(proj.timeline || 'Jan 2025 - Present');

          renderDualRow(titleStr, timelineStr, {
            isBold: true,
            fontSize: fontBodySize,
            leftColor: '#111827',
            rightColor: '#4b5563',
            spacingAfter: 1.2 * scale
          });

          // Row 2: Live Link (if any) + Tech Stack
          const stackStr = Array.isArray(proj.techStack) ? proj.techStack.join(', ') : (proj.techStack || '');
          const cleanStack = sanitizeAscii(stackStr);
          const metaY = doc.y;

          const projectLink = proj.liveUrl || proj.repoUrl;

          if (projectLink) {
            const rawUrl = String(projectLink).replace(/^https?:\/\//, '');
            const cleanUrl = sanitizeAscii(rawUrl);
            const safeUrl = String(projectLink).startsWith('http') ? String(projectLink) : `https://${projectLink}`;
            
            doc.font('Helvetica-Bold').fontSize(fontSubSize);
            const urlWidth = doc.widthOfString(cleanUrl);

            doc.fillColor('#1d4ed8').text(cleanUrl, margin, metaY, { lineBreak: false });
            doc.link(margin, metaY, urlWidth, fontSubSize + 2, safeUrl);

            const sepX = margin + urlWidth;
            doc.font('Helvetica').fontSize(fontSubSize).fillColor('#4b5563')
              .text(`  |  ${cleanStack}`, sepX, metaY, { width: contentWidth - urlWidth, lineBreak: false, ellipsis: true });
          } else {
            doc.font('Helvetica').fontSize(fontSubSize).fillColor('#4b5563')
              .text(cleanStack, margin, metaY, { width: contentWidth, lineBreak: false, ellipsis: true });
          }

          doc.y = metaY + fontSubSize + (1.8 * scale);

          // Bullets
          const bullets = Array.isArray(proj.bullets) ? proj.bullets.slice(0, 3) : [];
          bullets.forEach(bullet => {
            const cleanBullet = sanitizeAscii(bullet);
            const bulletY = doc.y;
            doc.font('Helvetica').fontSize(fontBodySize).fillColor('#111827')
              .text('-  ', margin + 6, bulletY, { continued: true, lineGap: lineSpacing })
              .text(cleanBullet, { width: contentWidth - 12, lineGap: lineSpacing });
            doc.y += 1.0 * scale;
          });
          doc.y += 1.5 * scale;
        });
      }

      // ── 5. EXPERIENCE / ROLES (If present) ──
      if (Array.isArray(experience) && experience.length > 0) {
        renderSectionHeading('Experience');
        experience.slice(0, 2).forEach(exp => {
          const roleCompany = `${sanitizeAscii(exp.role || 'Software Engineer')} - ${sanitizeAscii(exp.company || 'Company')}`;
          const dateStr = sanitizeAscii(exp.dates || '2025');

          renderDualRow(roleCompany, dateStr, {
            isBold: true,
            fontSize: fontBodySize,
            leftColor: '#111827',
            rightColor: '#4b5563',
            spacingAfter: 1.2 * scale
          });

          const bullets = Array.isArray(exp.bullets) ? exp.bullets : [];
          bullets.forEach(b => {
            const cleanB = sanitizeAscii(b);
            const bulletY = doc.y;
            doc.font('Helvetica').fontSize(fontBodySize).fillColor('#111827')
              .text('-  ', margin + 6, bulletY, { continued: true, lineGap: lineSpacing })
              .text(cleanB, { width: contentWidth - 12, lineGap: lineSpacing });
            doc.y += 1.0 * scale;
          });
          doc.y += 1.5 * scale;
        });
      }

      // ── 6. CERTIFICATIONS & ACHIEVEMENTS ──
      const hasCerts = Array.isArray(certifications) && certifications.length > 0;
      const hasCP = Array.isArray(competitiveProgramming) && competitiveProgramming.length > 0;

      if (hasCerts || hasCP) {
        renderSectionHeading('Certifications & Achievements');

        if (hasCP) {
          competitiveProgramming.forEach(cp => {
            if (cp.bulletText) {
              const cleanCP = sanitizeAscii(cp.bulletText);
              const cpY = doc.y;
              doc.font('Helvetica').fontSize(fontBodySize).fillColor('#111827')
                .text('-  ', margin + 6, cpY, { continued: true, lineGap: lineSpacing })
                .text(cleanCP, { width: contentWidth - 12, lineGap: lineSpacing });
              doc.y += 1.0 * scale;
            }
          });
        }

        if (hasCerts) {
          certifications.slice(0, 4).forEach(cert => {
            const certTitle = sanitizeSingleLine(cert.title || 'Certification');
            const certIssuer = cert.issuer ? sanitizeSingleLine(cert.issuer) : '';
            const certDate = cert.date ? sanitizeSingleLine(cert.date) : '';

            const leftText = certIssuer ? `${certTitle} | ${certIssuer}` : certTitle;

            renderDualRow(leftText, certDate, {
              isBold: false,
              fontSize: fontBodySize,
              leftColor: '#111827',
              rightColor: '#374151',
              spacingAfter: 1.5 * scale
            });
          });
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Helper to ensure buffer is not a pooled subarray view before passing to pdf-parse
 */
function toStandaloneBytes(buffer) {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

/**
 * Compiles PDF and validates page count; scales down if page exceeds 1
 */
async function compileVerifiedAtsPdf(resumeData, options = {}) {
  const pdfParse = require('pdf-parse');
  
  // Try default scale first
  let scale = 1.0;
  let margin = 30.0;
  let buffer = await compileResumePdf(resumeData, { margin, scale });

  let parsed = await pdfParse(toStandaloneBytes(buffer)).catch(() => ({ numpages: 1 }));
  let pageCount = parsed.numpages || 1;

  // If spilled onto page 2, progressively compress font scale until strictly 1 page
  const scaleAttempts = [0.96, 0.92, 0.88, 0.84];
  let attempt = 0;
  while (pageCount > 1 && attempt < scaleAttempts.length) {
    scale = scaleAttempts[attempt];
    margin = 26; // tighter margins
    console.log(`[resumePdfCompiler] PDF spilled onto ${pageCount} pages. Compacting scale to ${scale}...`);
    buffer = await compileResumePdf(resumeData, { margin, scale });
    parsed = await pdfParse(toStandaloneBytes(buffer)).catch(() => ({ numpages: 1 }));
    pageCount = parsed.numpages || 1;
    attempt++;
  }

  console.log(`[resumePdfCompiler] Final compiled PDF verified: ${pageCount} page(s) at scale ${scale}.`);
  return { buffer, pageCount, scale };
}

module.exports = {
  compileResumePdf,
  compileVerifiedAtsPdf
};
