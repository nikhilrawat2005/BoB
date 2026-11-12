# Resume Audit Engine: Blueprint & Deep Analysis

Based on a detailed extraction and analysis of both provided reference materials:
1. **`ABES Resume format.pdf`** (Gold standard 1-page single-column institutional format)
2. **`3 Resume_Building ( ATS Pre Post ).pptx`** (ATS rules, guidelines, Hiration-style scoring benchmark, do's & don'ts)

---

## 1. Deep Extraction & Key Principles from Reference Files

### A. Core Formatting & Visual Standards
- **Page Budget**: Strictly **1 Page** for undergraduate (UG) candidates. Margins: 0.5 inches all sides.
- **Typography**: Single consistent font family (e.g., Calibri, Arial, Helvetica).
  - Name: `16pt` (Bold)
  - Headings: `14pt` (Bold / Small Caps / Underline)
  - Body / Content: `12pt` / `10-11pt` for tight fit
- **Colors**: Professional palette only: Black, Blue, Grey, White. No fancy color splashes.
- **ATS Killer Traps (Zero Tolerance)**:
  - ❌ **No Tables or Multi-Column Grids** (causes text jumbling in ATS).
  - ❌ **No Photos / Headshots** (causes parsing errors).
  - ❌ **No Infographics, Skill Progress Bars, or Icons with unreadable glyphs**.
  - ❌ **No "Resume" or "Curriculum Vitae" Header Title** (wastes header space).
  - ❌ **No Declaration Statement** ("I hereby declare...").
  - ❌ **No Career Objective / Summary for UG** (Objective is obsolete; summary is only for experienced/PG).
  - ❌ **No Sensitive Personal Info**: DOB, Father's Name, Nationality, Marital Status, Full Postal Address.

### B. Standard Section Hierarchy & Ordering
1. **Header**: Name, City/State (optional), Phone, Professional Email, Hyperlinked LinkedIn, GitHub, Portfolio / LeetCode.
2. **Education**: Degree, Branch, Institute/Board, Aggregate % or CGPA, Passing Year (Reverse chronological).
3. **Technical Skills**: Grouped logically (`Languages`, `Developer Tools`, `Frameworks`, `Core Concepts`). No soft skills.
4. **Internships / Work Experience**: Role, Company, Location/Mode, Dates (Month Year – Month Year), Bullet points with action verbs.
5. **Projects**: Project Title, Tech Stack, Month/Year, Live Demo/GitHub link, Bullet points with quantified impact.
6. **Achievements / Certifications**: Ranks 1st-3rd only for achievements; verified credential links for certificates.
7. **Co-curricular / Extra-curricular**: Relevant leadership, hackathons, technical clubs, NGO/volunteering.

### C. Bullet Point Formula (Google X-Y-Z & CAR Method)
Every bullet point must obey:
> **Accomplished [X] as measured by [Y], by doing [Z]**
- **Action Verb**: Led, Developed, Engineered, Optimized, Implemented, Streamlined, Reduced, Automated.
- **Quantification**: Numbers, %, latency reduction, user count, test coverage, memory savings.
- **Tech Stack Context**: Explicit tool or framework used.

---

## 2. Resume Audit Engine: Scoring Rubric (100 Points)

| Category | Weight | Key Checks & Deductions |
| :--- | :---: | :--- |
| **1. ATS Compatibility & Format** | **25 pts** | Single column layout, no tables, no photos, no declaration, 1-page length, standard headings, clean font hierarchy. |
| **2. Header & Professional Footprint** | **15 pts** | Professional email (no nicknames), active LinkedIn URL, GitHub/Portfolio link, no postal address or DOB. |
| **3. Content Impact & Action Verbs** | **25 pts** | Starting bullets with strong action verbs (no passive voice), Google X-Y-Z formula, quantified metrics (%, numbers). |
| **4. Technical Skills & Grouping** | **15 pts** | Hard skills only (zero fluff/soft skills like "hardworking"), categorical grouping (Languages, Tools, Frameworks). |
| **5. Education, Projects & Experience** | **20 pts** | Reverse chronological order, dates (Month Year), role, tech stack mentioned per project, hyperlinks to repos/demos. |
| **Total** | **100 pts** | **Target Score: 75%+** (Benchmark set by Hiration / PPT Guidelines) |

---

## 3. Audit Engine Output Structure

When the engine analyzes a resume, it returns:
1. **Overall ATS Score** (0–100) with rating: `Needs Improvement (<60)`, `Competitive (60–74)`, `ATS Ready (75–89)`, `Elite (90–100)`.
2. **Category-wise Breakdown**:
   - ATS Format & Parseability
   - Header & Links
   - Action Verbs & Impact
   - Skills & Keywords
   - Experience & Projects
3. **Red Flags & Immediate Fixes**:
   - Detected tables, graphics, photos, declaration, soft skills.
4. **Line-by-Line Bullet Point Rewriter**:
   - Weak bullet: *"Worked on a humidifier project using Arduino."*
   - AI Recommended rewrite: *"Developed a portable humidifier using Arduino UNO to maintain >75% humidity, integrating DHT sensors and ultrasonic vibration."*
5. **Missing Critical Keywords** against targeted domain (e.g., Web Dev, Embedded Systems, Data Science).

---

## 4. Implementation Architecture for Backend

- **Step 1**: PyMuPDF / pdfplumber parser for extracting text, structure, hyperlink metadata, table/image detection.
- **Step 2**: Fast deterministic rule checker (Page count, margins, forbidden sections, header regex, email/phone format).
- **Step 3**: Gemini LLM semantic evaluator (Action verbs, X-Y-Z quantification check, rewrite suggestions, keyword gap analysis).
- **Step 4**: Aggregated diagnostic JSON & API response for frontend.
