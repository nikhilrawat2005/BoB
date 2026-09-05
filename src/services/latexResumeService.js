// ---------------------------------------------------------------------------
// Bob Resume Intelligence — LaTeX Resume & Tailoring Service
// ---------------------------------------------------------------------------
const { callLLM } = require('./llmService');
const { uploadBufferToCloudinary } = require('./fileService');
const fetch = require('node-fetch');

/**
 * Standard, battle-tested ATS Jake's Resume LaTeX Template
 */
function getJakesTemplateSkeleton() {
  return `\\documentclass[letterpaper,11pt]{article}
\\usepackage{latexsym}
\\usepackage[empty]{fullpage}
\\usepackage{titlesec}
\\usepackage{marvosym}
\\usepackage[usenames,dvipsnames]{color}
\\usepackage{verbatim}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fancyhdr}
\\usepackage[english]{babel}
\\usepackage{tabularx}

\\pagestyle{fancy}
\\fancyhf{} 
\\fancyfoot{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}

% Adjust margins
\\addtolength{\\oddsidemargin}{-0.5in}
\\addtolength{\\evensidemargin}{-0.5in}
\\addtolength{\\textwidth}{1in}
\\addtolength{\\topmargin}{-.5in}
\\addtolength{\\textheight}{1.0in}

\\urlstyle{same}
\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}

% Sections formatting
\\titleformat{\\section}{
  \\vspace{-4pt}\\scshape\\raggedright\\large
}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]

\\begin{document}

% --- HEADING ---
{{HEADING_SECTION}}

% --- EDUCATION ---
{{EDUCATION_SECTION}}

% --- TECHNICAL SKILLS ---
{{SKILLS_SECTION}}

% --- EXPERIENCE ---
{{EXPERIENCE_SECTION}}

% --- PROJECTS ---
{{PROJECTS_SECTION}}

% --- ACHIEVEMENTS / CODING STATS ---
{{ACHIEVEMENTS_SECTION}}

\\end{document}
`;
}

/**
 * Clean & sanitize user input for LaTeX special characters
 */
function escapeLatex(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Generate ATS-optimized LaTeX Resume code using LLM
 */
async function generateLatexResume({ profile, jobDescription = '', templateName = 'jake' }) {
  const isTargeted = Boolean(jobDescription && jobDescription.trim().length > 20);

  const prompt = `You are a World-Class Technical Resume Writer and LaTeX Expert.
Generate an ultra-clean, 1-page, ATS-compliant LaTeX resume based on the following candidate profile.

CANDIDATE MASTER PROFILE:
${JSON.stringify(profile, null, 2)}

${isTargeted ? `TARGET JOB VACANCY / DESCRIPTION:\n"""\n${jobDescription}\n"""\n\nTAILORING RULES:
1. Re-prioritize and select the candidate's MOST relevant projects and experiences matching this specific JD.
2. Emphasize matching skills (languages, frameworks, tools) prominently in the Technical Skills section.
3. Write strong STAR-method bullet points (Action Verb + Context/Tool + Quantifiable Result) tailored to the JD's requirements, WITHOUT hallucinating facts or tools the candidate didn't know.
` : `GENERAL ATS RULES:
1. Highlight top technical achievements, high-impact projects, and coding problem-solving milestones.
2. Ensure bullet points follow the Google/Harvard standard: "Accomplished [X] as measured by [Y], by doing [Z]".
`}

LATEX FORMATTING REQUIREMENTS:
- Use standard LaTeX packages compatible with pdflatex (article, fullpage, titlesec, hyperref, enumitem).
- Return ONLY the full compilable LaTeX code inside a \`\`\`latex ... \`\`\` codeblock.
- Do NOT output preamble explanations or notes outside the codeblock.
- Escape LaTeX special characters (like &, %, _, $) appropriately.
- Ensure the resume cleanly fits on 1 page (compact margins, concise bullet points, 2-3 bullets per project).
`;

  const response = await callLLM({
    messages: [
      { role: 'system', content: 'You are an elite technical career advisor and LaTeX developer.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  });

  const responseText = (response && response.text) ? response.text : String(response);
  const latexMatch = responseText.match(/```(?:latex|tex)?[\n\r]([\s\S]*?)```/i);
  const latexCode = latexMatch ? latexMatch[1].trim() : responseText.trim();

  return {
    latexCode,
    isTargeted,
    summary: isTargeted ? 'Resume custom-tailored for target job description' : 'General master ATS resume generated'
  };
}

/**
 * Compile LaTeX code to PDF using public TeX compilation engine or fallback service
 */
async function compileLatexToPdf(latexCode) {
  const endpoints = [
    'https://latexonline.cc/compile?text=',
    'https://texlive.net/cgi-bin/latexcgi?text='
  ];

  for (const ep of endpoints) {
    try {
      const compileRes = await fetch(ep + encodeURIComponent(latexCode), {
        method: 'GET',
        timeout: 30000
      });

      if (compileRes.ok) {
        const buffer = await compileRes.buffer();
        if (buffer && buffer.length > 500 && buffer.slice(0, 4).toString() === '%PDF') {
          return { success: true, buffer };
        }
      }
    } catch (err) {
      console.warn(`[LatexResumeService] Compiler ${ep} failed:`, err.message);
    }
  }

  // If external compiler unavailable or times out, return cleanly formatted error + LaTeX source
  return {
    success: false,
    error: 'LaTeX compiler service is temporarily busy. You can click "Open Overleaf" or copy the LaTeX code to download instantly.'
  };
}

/**
 * Compile & upload generated resume PDF directly to Cloudinary
 */
async function buildAndStoreResumePdf(userId, latexCode, resumeTitle = 'resume') {
  const result = await compileLatexToPdf(latexCode);
  if (!result.success || !result.buffer) {
    return {
      pdfUrl: null,
      error: result.error,
      latexCode
    };
  }

  const uploadResult = await new Promise((resolve, reject) => {
    const cloudinary = require('../config/cloudinary');
    const { Readable } = require('stream');
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `bob/${userId}/resumes`,
        resource_type: 'raw',
        format: 'pdf',
        public_id: `${resumeTitle}_${Date.now()}`
      },
      (error, res) => (error ? reject(error) : resolve(res))
    );
    Readable.from(result.buffer).pipe(uploadStream);
  });

  return {
    pdfUrl: uploadResult.secure_url,
    publicId: uploadResult.public_id,
    latexCode,
    success: true
  };
}

module.exports = {
  getJakesTemplateSkeleton,
  escapeLatex,
  generateLatexResume,
  compileLatexToPdf,
  buildAndStoreResumePdf
};
