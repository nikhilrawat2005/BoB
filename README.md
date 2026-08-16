# 🤖 Bob — Autonomous AI Companion & Engineering System

Bob is an autonomous AI assistant, vibecoding builder, and personal intelligence engine built for master developer Nikhil. The system connects an intelligent Node.js backend with Firestore memory, Cloudinary storage, OpenRouter LLMs, real-time web crawlers, and a responsive web client.

---

## 🏗️ Architecture Overview

```
bob-backend/
├── src/
│   ├── server.js              # Express app & middleware entrypoint
│   ├── config/
│   │   ├── firebase.js        # Firebase Admin initialization (Auth & Firestore)
│   │   └── cloudinary.js      # Cloudinary storage configuration
│   ├── middleware/
│   │   └── auth.js            # Firebase ID Token verification & multi-auth handling
│   ├── routes/
│   │   ├── chat.js            # POST /api/chat (LLM streaming, tools, proactive insights)
│   │   ├── files.js           # Upload, view, stream, download, and delete files
│   │   ├── memory.js          # CRUD operations for structured facts & memory
│   │   ├── sessions.js        # Session & conversation message history
│   │   ├── builder.js         # Builder & vibecoding workspace endpoints
│   │   ├── hackathons.js      # Hackathon tracking & crawling
│   │   ├── stalking.js        # Deep social web profile intelligence & crawler
│   │   ├── secretVault.js     # Passcode-protected secure vault
│   │   ├── scheduler.js       # Autonomous task scheduler & reminders
│   │   └── routines.js        # Daily autonomous routines & habits
│   └── services/
│       ├── llmService.js      # OpenRouter LLM orchestration & model fallbacks
│       ├── memoryService.js   # 6-category structured memory & vector retrieval
│       ├── fileService.js     # Cloudinary upload/delete + Firestore synchronization
│       ├── documentReaderService.js # In-memory PDF, DOCX, XLSX text extractor
│       ├── crawlerService.js  # Deep web page scraper & JSON-LD link extractor
│       ├── hackathonService.js # Devpost / Unstop competition scraping
│       ├── stalkingService.js # Multi-network profile discovery & entity resolution
│       ├── youtubeService.js  # YouTube transcripts & media detection
│       ├── instagramService.js# Instagram profile & post scraping
│       ├── weatherService.js  # Real-time weather data
│       └── stocksService.js   # Market & financial tracking
├── public/                    # Frontend client (HTML5, Vanilla JS, CSS3)
│   ├── index.html             # Single Page Application UI
│   ├── app.js                 # Frontend orchestration, chat, audio, & workspaces
│   └── style.css              # Cyber-minimal dark theme design system
├── .env.example               # Environment variables template
├── vercel.json                # Vercel Serverless deployment config
└── package.json
```

---

## ⚡ Key Workspaces & Capabilities

### 1. 📁 File Vault & Storage
- **Native PDF & Document Streaming**: Open PDFs, Word docs, and spreadsheets directly in browser tabs via native streaming (`GET /api/files/:id/view`) with zero external viewer issues.
- **Direct Download & Cloudinary Sync**: 1-click downloads and permanent storage cleanup from Cloudinary upon file deletion.
- **AI-Readable Recognition**: Automatic text extraction from PDFs, DOCX, and code files so Bob can reference their actual text content in chats.
- **Sticky Filtering & Status Stats**: Search and filter by file types (`Documents`, `Sheets`, `Code`, `Media`) with persistent sticky tabs.

### 2. 🧠 Structured Memory Bank
Categorized long-term memory across 6 dedicated pillars:
- 🎯 **Habits & Preferences**: Personal workflow, coding styles, daily routines.
- 🧠 **Main Memory**: General facts, career goals, personal knowledge.
- 🏆 **Hackathons**: Competition problem statements, team members, deadlines, pitches.
- 🕵️ **Stalker Intelligence**: Target profiles, social accounts (IG, LinkedIn, GitHub, X), crawled data.
- 🔒 **Secret Vault**: Passcode-secured confidential keys, notes, and credentials.
- 🛠️ **Builder & Codebase**: Architecture plans, tech stacks, DSA progress, vibecoding notes.

### 3. 🛠️ Builder Workspace
- Vibecoding companion for architecting systems, creating PRDs, and tracking development milestones.
- Instant access to Bob's knowledge base and shared codebase memory.

### 4. 🕵️ Stalker Intelligence & Deep Crawler
- Automated network crawling across LinkedIn, GitHub, X, Instagram, and web portfolios.
- Extracts JSON-LD schema metadata, tech stacks, outgoing profile links, and bio details.

### 5. 🏆 Hackathon Tracker
- Real-time crawler for Devpost and Unstop.
- Tracks problem statements, submission requirements, team members, and winning strategies.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ (Node 20+ recommended)
- Firebase Project with Firestore & Authentication enabled
- Cloudinary Account
- OpenRouter API Key

### Installation

```bash
# Clone repository
git clone https://github.com/nikhilrawat2005/BoB.git
cd bob-backend

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
```

### Environment Configuration (`.env`)

Configure the following keys in `.env`:
```env
PORT=3000
NODE_ENV=development
ALLOWED_EMAILS=your_email@gmail.com
SHARED_ADMIN_ID=nikhil_master_workspace

# OpenRouter
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet

# Firebase Admin SDK
FIREBASE_PROJECT_ID=bob-...
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### Running Locally

```bash
# Start development server
npm run dev

# Or start standard server
npm start
```

Access the application in your browser at `http://localhost:3000`.

---

## 📡 API Endpoints Reference

All `/api/*` endpoints (except `/api/health`) require authentication:
- Header: `Authorization: Bearer <firebase-id-token>`
- Or query parameter (for direct browser view): `?token=<firebase-id-token>`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health check |
| `POST` | `/api/chat` | Send message and receive LLM response |
| `GET` | `/api/sessions` | List chat sessions for authenticated user |
| `POST` | `/api/sessions` | Create a new chat session |
| `GET` | `/api/sessions/:id/messages` | Retrieve conversation history |
| `GET` | `/api/files` | List all uploaded files with AI metadata |
| `POST` | `/api/files/upload` | Upload document or media (`multipart/form-data`) |
| `GET` | `/api/files/:id/view` | Stream file with `inline` disposition (native browser view) |
| `GET` | `/api/files/:id/download` | Stream file with `attachment` disposition (force download) |
| `DELETE` | `/api/files/:id` | Delete file from Cloudinary and Firestore |
| `POST` | `/api/files/generate` | Generate real binary office files (.xlsx, .docx, .pdf, .pptx) |
| `GET` | `/api/memory/facts` | Retrieve categorized facts |
| `POST` | `/api/memory/facts` | Save a new structured fact |
| `DELETE` | `/api/memory/facts/:id` | Remove a fact from memory |
| `GET` | `/api/hackathons` | List tracked hackathons and scraped data |
| `POST` | `/api/hackathons/scrape` | Scrape a hackathon URL (Devpost / Unstop) |
| `GET` | `/api/stalking/profiles` | List tracked social/professional profiles |
| `POST` | `/api/stalking/crawl` | Deep-crawl a target profile or website |

---

## 🚢 Deployment (Vercel)

1. Push your changes to GitHub:
   ```bash
   git push origin main
   ```
2. Connect your repository to **Vercel**.
3. In Vercel Project Settings, add all variables from `.env`.
4. Deploy — your backend and frontend will be live on your custom Vercel domain!
