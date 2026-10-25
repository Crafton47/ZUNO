# AGENTS.md — AURA 2.0 Project Context & Architecture Guide

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
