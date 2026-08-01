# Bob Backend

Proper server for Bob — the LLM router, memory (Firestore), auth (Firebase),
and file storage (Cloudinary) all live here. The frontend (web/Android/laptop
client) talks to this backend only — it never calls OpenRouter, Firebase, or
Cloudinary directly.

## Folder structure

```
bob-backend/
├── src/
│   ├── server.js          # Express app entry point
│   ├── config/
│   │   ├── firebase.js    # Firebase Admin init (auth + Firestore)
│   │   └── cloudinary.js  # Cloudinary init
│   ├── middleware/
│   │   └── auth.js        # Verifies Firebase ID token on every protected route
│   ├── services/
│   │   ├── llmService.js     # All OpenRouter calls go through here
│   │   ├── memoryService.js  # Firestore reads/writes for sessions, messages, facts
│   │   └── fileService.js    # Cloudinary upload + Firestore file records
│   └── routes/
│       ├── chat.js        # POST /api/chat
│       ├── sessions.js    # GET/POST /api/sessions, GET /api/sessions/:id/messages
│       ├── memory.js      # GET/POST/DELETE /api/memory/facts
│       └── files.js       # POST /api/files/upload, GET /api/files
├── .env.example            # Copy to .env and fill in real keys
├── vercel.json              # Deployment config for Vercel
└── package.json
```

## Why this shape

- **routes/** only handle HTTP — parsing request, calling a service, returning JSON.
- **services/** hold all the actual logic (talking to OpenRouter, Firestore, Cloudinary).
  This means if you ever swap Cloudinary for something else, you only touch `fileService.js`.
- **middleware/auth.js** runs before every protected route, so every route automatically
  knows *which user* is calling (`req.userId`) — no user ever sees another user's data.
- **config/** is just initialization — one place per external service.

## Running locally

```bash
npm install
cp .env.example .env
# fill in .env with your real OpenRouter / Firebase / Cloudinary keys
npm run dev
```

Server runs at `http://localhost:3000`. Test it:
```bash
curl http://localhost:3000/api/health
```

## API summary

All routes except `/api/health` require:
```
Authorization: Bearer <firebase-id-token>
```
(the frontend gets this token right after Firebase Auth login)

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/chat` | Send a message, get Bob's reply |
| GET | `/api/sessions` | List all chat sessions for this user |
| POST | `/api/sessions` | Create a new chat session |
| GET | `/api/sessions/:id/messages` | Get all messages in a session |
| GET | `/api/memory/facts` | List saved facts about the user |
| POST | `/api/memory/facts` | Add a fact |
| DELETE | `/api/memory/facts/:id` | Remove a fact |
| POST | `/api/files/upload` | Upload a file (multipart, field `file`) |
| GET | `/api/files` | List uploaded files |

## Deploying to Vercel

1. Push this folder to a GitHub repo.
2. Import the repo in Vercel.
3. Add all keys from `.env.example` as Environment Variables in Vercel project settings.
4. Deploy. Your API will be live at `https://your-project.vercel.app/api/...`

See `BOB_SETUP_GUIDE.md` (shared separately) for how to actually create the
Firebase project, Cloudinary account, and OpenRouter key from scratch.

## Next steps (not yet built)

- Frontend rewrite to call this backend instead of OpenRouter directly
- Auto-extraction of facts from conversation (currently manual add only)
- Android client (calls the same `/api/*` routes)
- Screen-vision endpoint (`/api/vision/analyze`) for the automation feature
