# AGENTS.md — ZUNO PLAYCORE Project Context & Architecture Guide

## Exam Rescue (27 October 2026)

Read `docs/EXAM-RESCUE.md` for the deterministic planner, reviewed AI topic extraction, preview/apply contract and limitations. `exam-engine.js` is pure scheduling logic; `exam-rescue.js` mounts behind the Study owner/notebook gates. Additive tables: `exam_plans`, `exam_previews`, `exam_task_links`, `study_quiz_results`. Generated missions reuse `schedule_tasks` and `study_tasks`; preserve completed work and unique plan/block links. `public/study-playcore.css` supplies the charcoal/lime Study theme; `public/exam-rescue.js` adds the four-section navigation and planner; `public/exam-next.js` supplies the Command Center shortcut. Run `npm test` (includes `tests/exam-rescue.test.cjs`); live tests use temporary records only.

### Study Studio Navigation & Cold Boot Contract
- **4 Autonomous Sections**: 1. `My Notebooks`, 2. `Ask ZUNO`, 3. `Practice Lab`, 4. `Exam Rescue`. All sections open directly from the top navigation bar, sidebar, Command Center shortcut (`public/exam-next.js`), direct URL (`/study?section=...`), or browser refresh without requiring an open notebook first.
- **Cold URL Preservation**: Preserves `?notebook=<id>` query parameters during initial boot and section switching so deep-links or refreshes never clear the selected notebook before authentication/status resolves.
- **Form Nesting Hygiene**: File upload form (`upload-form`) mounts to `#rescue-upload-host` only during Step 2 (The Material) and returns to `uploadHome` on Step 3 and landing views to avoid nested form conflicts or button collisions.
- **Fallback Picker**: When entering `Ask ZUNO` or `Practice Lab` without a selected notebook, a contextual notebook selector (`#study-picker`) is displayed with 1-click notebook choices and create/upload shortcuts.

## Current repair additions

Read `docs/PLAYCORE-REPAIR.md` for Study Studio architecture, API contract, setup and security boundaries. `study.js` is mounted behind the existing companion authentication middleware; `study.html` is the native `/study` frontend. Open Notebook 1.15.0 and SurrealDB 2.3.10 run in isolated digest-pinned Docker services (`deploy/compose.yml`). Access is limited to `STUDY_OWNER_ID` and all notebooks/material are ownership-checked. Do not enable public multi-user use or expose the service password to browsers.

`database.js` adds `study_notebooks`, `study_items`, `study_tasks`, `study_messages`; existing tasks actually live in `schedule_tasks` (the legacy schema description below is outdated). `public/playcore.js` controls mascot channels; `public/mascot.js`/`.css` render the vector interpretation of the original logo. `public/companion.js` supplies actual audio levels and call events.

Run `npm test`. Opt-in `npm run test:study:live` uses the running service and real provider, with temporary ZUNO accounts/database. Never commit `.env`, `deploy/.env`, databases or runtime logs. Keep existing dashboard IDs and features.

## Study Studio 2.0 — Learning Experience Upgrade (27 October 2026)

`study.html` + `public/study.js` + `public/study.css` were overhauled. `study.js` received new backend endpoints. All existing notebooks, uploaded PDFs, notes, tasks, ownership and auth are preserved.

### New backend endpoints (all in `study.js`, behind `STUDY_OWNER_ID` gate):
- `POST /notebooks/:id/exam` — Exam Mode answers (`examType`: `3mark`, `5mark`, `10mark`, `revision`, `detailed`)
- `POST /notebooks/:id/quiz` — Generate 5 MCQ questions as JSON from notebook content
- `POST /notebooks/:id/flashcards/generate` — Generate 8 flashcards, saved to `study_flashcards`
- `GET  /notebooks/:id/flashcards` — List saved flashcards for notebook
- `PATCH /notebooks/:id/flashcards/:cardId` — Update difficulty (`easy`/`hard`/`new`)
- `DELETE /notebooks/:id/flashcards/:cardId` — Remove one flashcard
- `POST /notebooks/:id/xp` — Award XP (abuse-resistant: one award per event per notebook per hour)
- `GET  /xp` — Total XP, level, and next-level threshold for user
- `POST /notebooks/:id/feedback` — Helpful/not helpful on a study message
- `POST /notebooks/:id/explain` — Explain Simply (simplified grounded answer, saved to history)

### New DB tables (additive, never drops existing data):
- `study_flashcards (id, notebook_id, user_id, front, back, difficulty, reviewed_at, created_at)`
- `study_xp (id, user_id, notebook_id, event, earned, earned_at)`
- `study_feedback (id, message_id, user_id, helpful, created_at)`

### Frontend features:
- **Tabbed interface**: Ask, Exam Mode, Quiz Me, Flashcards
- **Markdown rendering**: Built-in safe renderer (headings, bold, italic, lists, tables, code blocks, blockquotes, links) — no raw AI HTML injected
- **Answer toolbar**: Copy, Save as note, Explain Simply, Exam Answer shortcut, Quiz Me, Flashcards, 👍/👎 feedback
- **Suggested prompts**: Chip buttons that pre-fill the question textarea
- **Exam Mode**: 5 answer-length presets; renders in the Ask panel with exam badge
- **Quiz Me**: Interactive MCQ, immediate feedback per answer, explanation, final score ring, retry
- **Flashcards**: 3D flip animation, Easy/Hard difficulty marking, prev/next nav, card list with delete
- **XP bar**: Level + progress bar in sidebar; XP toast on award; abuse-resistant (1-hour cooldown per event per notebook)
- **ZUNO design system**: Space Grotesk headings, Plus Jakarta Sans body, full color palette, ambient glow, focus mode support, reduced motion

### Security:
- All AI-generated content is sanitized through the Markdown renderer before DOM insertion — no `innerHTML` from raw API responses
- XP cannot be farmed: server enforces 1-hour cooldown per event per notebook
- Feedback, flashcards, and XP are all ownership-checked server-side
- No new public endpoints; all routes still behind `STUDY_OWNER_ID` gate

> **For AI Agents:** Read this file first to understand the application architecture, schemas, API contracts, design system, and operational guidelines without needing to parse the entire codebase.

---

## 1. Executive Summary

- **Product Name:** AURA 2.0
- **Tagline:** Futuristic Gen Z AI Workspace & Productivity Companion
- **Core Functionality:**
  - **Live AI Voice Companion:** Bi-directional, real-time native audio conversation using Google Gemini Live API via an AudioWorklet streaming proxy with interruption handling and audio-reactive orb visualization.
  - **AI Chat & Task Detection:** Context-aware productivity chat powered by Gemini or NVIDIA Nemotron, automatically detecting task creation intents and syncing them directly with the planner.
  - **Mission Control (Daily Planner):** Task scheduling, deadlines, overdue tracking, reminder notifications, and 12-month yearly planner view.
  - **Gamification & Surprise Movie Rewards:** When users complete missions, AURA unlocks a cyberpunk movie-ticket reward card with trailers and celebratory confetti.
  - **Vibe Check (Mood Studio):** 8 curated mood presets recommending music playlists (Spotify), movies (trailers), comfort food ideas, and offline activities.
  - **Authentication & Personal Context:** JWT authentication with bcrypt hashing, personalized memory notes stored per account.

---

## 2. Tech Stack & Dependencies

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Runtime** | Node.js (>= 20.19.0) | CommonJS modules (`require`) |
| **Server** | Express.js (`express` v4.18.2) + HTTP/WS | Handles REST APIs, static file routing, and WebSocket upgrades (`ws` v8.22.0) |
| **AI Providers** | `@google/genai` (v2.31.0) & NVIDIA API | Gemini 2.5 Live (voice) + Gemini 2.5 Flash / NVIDIA Nemotron (chat) |
| **Database** | SQLite via `sql.js` (v1.12.0 WASM) | Pure JavaScript/WASM SQLite with automatic disk synchronization to `vibeai.db` |
| **Auth & Security** | `bcrypt` (v6.0.0) + `jsonwebtoken` (v9.0.2) | 12 salt rounds; stateless JWT; secure one-time 30-second voice tickets |
| **Frontend** | Vanilla HTML5 / CSS3 / ES6+ JS | Zero heavy UI dependencies. Uses Web Audio API (`AudioWorkletNode`), WebSockets, CSS Custom Properties |
| **Testing** | Node.js Test Runner + `@playwright/test` | Automated end-to-end tests simulating providers and headless browser interactions |

---

## 3. Neo-Futuristic Design System

Built specifically for Gen Z students: sleek, distraction-free, cyber-inspired, and accessible.

### Global Color Palette
- **Background (`--bg`):** `#080914` (60% dark neutral foundation with ambient violet/cyan gradients)
- **Surface (`--surface`):** `#17152D` (cards, panels, and sidebars)
- **Elevated (`--elevated`):** `#22203A` (nested cards, inputs, and controls)
- **Electric Violet (`--violet`):** `#925BFF` (AI companion identity and primary brand buttons)
- **Cyber Cyan (`--cyan`):** `#39E8FF` (interactive highlights, focus rings, and accents)
- **Acid Lime (`--lime`):** `#D7FF65` (missions completed, achievements, and movie rewards)
- **Neon Pink (`--pink`):** `#FF73C6` (streaks, overdue warnings, and special moments)
- **Primary Text (`--text`):** `#F7F5FF`
- **Secondary Text (`--muted`):** `#B5AED1`
- **Border (`--border`):** `#373055`

### Typography Scale
- **Display & Headings:** `Space Grotesk` (weights 500, 600, 700)
- **Body & Inputs:** `Plus Jakarta Sans` (weights 400, 500, 600, 700, 800)
- **Accessibility:** All labels, captions, and metadata are maintained at or above 11px to conform with WCAG AA contrast and scannability.
- **Motion:** Full support for `prefers-reduced-motion` with graceful animation degradation.

---

## 4. Repository & File Structure

```
project 2/
├── .env                  # Environment secrets (JWT secret, API keys, models)
├── .env.example          # Environment variable template
├── package.json          # Dependencies, scripts (npm start, npm test)
├── server.js             # Express app, static routing, auth routes, entrypoint
├── companion.js          # Live voice WebSocket proxy, chat routing, companion endpoints
├── chat-provider.js      # Provider abstraction for Gemini and NVIDIA Nemotron
├── scheduler.js          # SQLite persistence for tasks, reminders, iCalendar exporter
├── database.js           # Core SQLite wrapper using sql.js with saveToDisk sync
├── vibeai.db             # Binary SQLite database persisted to disk
├── index.html            # Main AURA 2.0 Workspace dashboard
├── login.html            # AURA 2.0 Sign In page
├── register.html         # AURA 2.0 Account Creation page with password strength meter
├── legacy.html           # Original offline recommendation engine (accessible at /ideas)
├── AGENTS.md             # This agent reference guide
├── README.md             # Developer & user guide
├── public/               # Static assets served at /assets
│   ├── companion.css     # Complete AURA 2.0 design system styles
│   ├── companion.js      # Chat UI, live audio WebSocket client, mood engine hook
│   ├── scheduler.js      # Daily planner UI, year view, rewards & confetti trigger
│   ├── mood.js           # Lifestyle recommendation catalog (music, movies, food, activities)
│   └── audio-worklet.js  # Low-latency PCM capture worklet for live voice streaming
└── tests/
    ├── companion.test.cjs # End-to-end integration and Playwright browser test suite
    └── fake-provider.cjs  # Simulated AI provider for offline zero-cost testing
```

---

## 5. Database Schema (SQLite via `sql.js`)

Persisted to `vibeai.db` in the workspace root (overridden by `DB_PATH` in tests).

```sql
-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    UNIQUE NOT NULL,
  email       TEXT    UNIQUE NOT NULL,
  password    TEXT    NOT NULL,
  created_at  TEXT    DEFAULT (datetime('now'))
);

-- 2. Companion Profiles (Personal Memory Notes)
CREATE TABLE IF NOT EXISTS companion_profiles (
  user_id     INTEGER PRIMARY KEY,
  notes       TEXT    NOT NULL DEFAULT '',
  updated_at  TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Companion Messages (Recent Chat History, capped at 60)
CREATE TABLE IF NOT EXISTS companion_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  role        TEXT    NOT NULL,
  text        TEXT    NOT NULL,
  created_at  TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Companion Tasks (Mission Control)
CREATE TABLE IF NOT EXISTS companion_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  title        TEXT    NOT NULL,
  due_at       TEXT    NOT NULL,
  timezone     TEXT    NOT NULL DEFAULT 'UTC',
  completed    INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  reward_json  TEXT,
  created_at   TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 5. Companion Reminders (In-app and Desktop Notifications)
CREATE TABLE IF NOT EXISTS companion_reminders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  task_id      INTEGER NOT NULL,
  kind         TEXT    NOT NULL,
  remind_at    TEXT    NOT NULL,
  dismissed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES companion_tasks(id) ON DELETE CASCADE
);
```

---

## 6. API Specification

All protected endpoints require header: `Authorization: Bearer <vibe_token>`.

### Authentication Endpoints
- `POST /api/register`: Creates new user `{ username, email, password }`
- `POST /api/login`: Validates credentials, returns `{ success: true, token, user }`
- `GET /api/me`: Validates JWT token, returns current `{ user }`
- `POST /api/logout`: Confirms stateless client-side session destruction

### Companion & AI Endpoints
- `GET /api/companion`: Returns `{ configured, chatConfigured, chatProvider, notes, messages }`
- `PUT /api/companion/profile`: Updates user memory notes `{ notes }` (up to 2,000 characters)
- `DELETE /api/companion/history`: Clears user message history
- `POST /api/companion/chat`: Sends message `{ text, timezone }`; returns `{ text }`. Automatically parses task intents into missions.
- `POST /api/companion/call`: Issues single-use 30-second ticket `{ ticket }` for WebSocket upgrade
- `GET /api/companion/tasks`: Returns all tasks for the logged-in user
- `POST /api/companion/tasks`: Creates tasks `{ tasks: [{ title, dueAt }], timezone }`
- `PATCH /api/companion/tasks/:id`: Updates task status `{ completed }`. If completed, attaches a movie reward `{ reward: { title, url } }`
- `DELETE /api/companion/tasks/:id`: Removes task
- `GET /api/companion/reminders`: Returns pending notifications for the user's timezone
- `POST /api/companion/reminders/ack`: Acknowledges and dismisses reminder IDs `{ ids: [...] }`
- `GET /api/companion/calendar`: Generates standard `.ics` iCalendar export with 15-minute `VALARM`
- `WS /api/companion/live?ticket=<ticket>`: Live bidirectional Gemini audio stream

---

## 7. Operational Guidelines for Agents

1. **Strict Zero-Destructive Rule:**
   - Never remove existing features or routes (`/chat`, `/ideas`, `/api/*`).
   - Keep all element IDs in HTML and JS intact (`#message`, `#send`, `#call`, `#planner-tasks`, `#reward-dialog`, etc.).
2. **Database In-Memory Persistence:**
   - `sql.js` runs in WebAssembly memory. Every write query (`INSERT`, `UPDATE`, `DELETE`) must trigger `saveToDisk()` to write changes back to `vibeai.db`.
3. **Security & Secrets:**
   - Never embed API keys (`GEMINI_API_KEY`, `NVIDIA_API_KEY`, `JWT_SECRET`) in client-side code.
   - Authentication tokens are stored in browser `localStorage` as `vibe_token` and `vibe_user`.
4. **Testing Before Completion:**
   - Always verify changes with `npm test`. On Windows, the test runner spawns local servers and uses browser automation, requiring sandbox bypass (`BypassSandbox: true`).
