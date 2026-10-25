# ZUNO PLAYCORE 2.0

The existing dashboard now includes a native Open Notebook Study Studio and an expressive SVG companion. See [repair, setup, security and verification report](docs/PLAYCORE-REPAIR.md) for current instructions. Study Studio is restricted to one configured local account; it is not a public multi-user deployment.

Quick local study setup: `npm run study:setup`, then `docker compose -f deploy/compose.yml --env-file deploy/.env up -d`, then `npm run study:model`. Start ZUNO with `npm start`. Preserve your existing `.env` and database.

The earlier AURA documentation below describes the preserved companion/planner features.

[![Node.js](https://img.shields.io/badge/Node.js-20.19+-green.svg)](https://nodejs.org/)
[![AI Provider](https://img.shields.io/badge/AI-Gemini%20Live%20%7C%20NVIDIA-blueviolet.svg)](https://ai.google.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **For AI Agents & Developers:** Consult [`AGENTS.md`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/AGENTS.md) for full architectural maps, database schemas, API specs, and technical rules.

---

**AURA 2.0** is a full-stack personal AI workspace and productivity companion designed for Gen Z students. It blends a neo-futuristic, cyber-inspired aesthetic with real-time AI voice conversation, automated task scheduling, daily and yearly mission planning, mood-based lifestyle recommendations, and gamified movie rewards.

---

## Key Features

- **🎙 Live AI Voice Companion:**
  - Real-time, bidirectional voice calls powered by Google Gemini Live native audio.
  - Low-latency PCM capture via native browser `AudioWorkletNode`.
  - Natural conversation flow: interrupt AURA at any point while it speaks.
  - 4-state audio-reactive orb visualization: idle breathing, processing rotation, listening pulse, and speaking waveform.
- **💬 Context-Aware AI Chat & Task Detection:**
  - Chat with AURA using either Google Gemini 2.5 Flash or NVIDIA Nemotron (`CHAT_PROVIDER=nvidia`).
  - Automatic task intent detection: tell AURA what you need to do, and it schedules it directly into your planner.
- **⚡ Mission Control & Daily Planner:**
  - Visual task tracking with status indicators, deadlines, and overdue notices.
  - Expandable 12-month **Year View** showing mission density across the entire year.
  - In-app reminder nudges and one-click standard **iCalendar export (`.ics`)** with 15-minute alarms.
- **🎬 Gamification & Surprise Movie Rewards:**
  - Earn a surprise movie recommendation upon completing a mission.
  - Unlocks a cyberpunk movie-ticket card with direct trailer search and celebratory particle bursts.
- **✦ Vibe Check (Mood Studio):**
  - 8 curated mood presets (On a high, Feeling low, Overwhelmed, Just chilling, Need energy, Locked in, Bored, In my feels).
  - Instant recommendations for Spotify music playlists, movie trailers, comfort meals, and offline activities.
  - Chat integration: ask AURA to personalize recommendations based on your preferences.
- **🔒 Secure Authentication & Memory:**
  - Secure registration and sign-in with bcrypt password hashing and stateless JWT.
  - Interactive password strength visualizer with cyber-tinted indicators.
  - Editable "About you" personal context notes sent only to your AI companion.

---

## Quickstart

### 1. Prerequisites
- **Node.js:** v20.19.0 or newer (v22 LTS recommended)
- **Microphone:** Required for voice calls (headphones recommended to prevent echo)

### 2. Installation
```bash
# Clone or navigate to the repository
cd "project 2"

# Install dependencies
npm install

# Install Playwright browser dependencies (for testing)
npx playwright install chromium
```

### 3. Environment Configuration
Copy the template to create your `.env` file:
```bash
cp .env.example .env
```

Edit `.env` to configure your keys:
```properties
PORT=3000
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=7d

# Google Gemini (required for voice calls & default chat)
GEMINI_API_KEY=your_gemini_api_key_from_aistudio
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
GEMINI_CHAT_MODEL=gemini-2.5-flash

# Optional NVIDIA chat configuration
CHAT_PROVIDER=gemini # set to 'nvidia' to use NVIDIA Nemotron for chat
NVIDIA_API_KEY=
NVIDIA_CHAT_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
```

### 4. Running the Application
```bash
# Start server
npm start
```

Access the application in your browser:
- **Sign In / Landing:** [http://localhost:3000](http://localhost:3000)
- **Create Account:** [http://localhost:3000/register.html](http://localhost:3000/register.html)
- **AURA Workspace:** [http://localhost:3000/chat](http://localhost:3000/chat)
- **Original Offline Engine:** [http://localhost:3000/ideas](http://localhost:3000/ideas)

---

## Running Automated Tests

AURA includes an end-to-end integration and Playwright browser test suite that verifies account isolation, AI chat, live voice ticket lifecycle, task creation, planner synchronization, and movie reward unlocks using a zero-cost simulated provider:

```bash
npm test
```

---

## Repository Structure

- [`server.js`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/server.js): Express HTTP server, static file router, authentication endpoints.
- [`companion.js`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/companion.js): WebSocket proxy for live Gemini voice streaming and companion APIs.
- [`chat-provider.js`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/chat-provider.js): Multi-provider chat interface (Google Gemini & NVIDIA Nemotron).
- [`scheduler.js`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/scheduler.js): Task, reminder, and iCalendar storage manager.
- [`database.js`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/database.js): SQLite database layer using `sql.js` (persisted to `vibeai.db`).
- [`index.html`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/index.html): Main AURA 2.0 workspace dashboard.
- [`login.html`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/login.html) & [`register.html`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/register.html): AURA 2.0 styled authentication views.
- [`legacy.html`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/legacy.html): Original standalone client-side recommendation engine (at `/ideas`).
- [`public/`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/public): Client-side styles, scripts, and audio capture worklet.

---

## Privacy & Security

- **Server-Held Credentials:** AI API keys remain strictly on the backend.
- **Ephemeral Voice Tokens:** Voice calls upgrade via single-use, 30-second cryptographic tickets.
- **Audio Privacy:** Audio streams are processed live in-memory; **no audio recordings are ever saved to disk**.
- **15-Minute Safeguard:** Live voice calls automatically cap at 15 minutes per session to prevent accidental open microphones or excessive API quota usage.

Access the application in your browser:
- **Sign In / Landing:** [http://localhost:3000](http://localhost:3000)
- **Create Account:** [http://localhost:3000/register.html](http://localhost:3000/register.html)
- **AURA Workspace:** [http://localhost:3000/chat](http://localhost:3000/chat)
- **Original Offline Engine:** [http://localhost:3000/ideas](http://localhost:3000/ideas)

---

## Running Automated Tests

AURA includes an end-to-end integration and Playwright browser test suite that verifies account isolation, AI chat, live voice ticket lifecycle, task creation, planner synchronization, and movie reward unlocks using a zero-cost simulated provider:

```bash
npm test
```

---

## Repository Structure

- [`server.js`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/server.js): Express HTTP server, static file router, authentication endpoints.
- [`companion.js`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/companion.js): WebSocket proxy for live Gemini voice streaming and companion APIs.
- [`chat-provider.js`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/chat-provider.js): Multi-provider chat interface (Google Gemini & NVIDIA Nemotron).
- [`scheduler.js`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/scheduler.js): Task, reminder, and iCalendar storage manager.
- [`database.js`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/database.js): SQLite database layer using `sql.js` (persisted to `vibeai.db`).
- [`index.html`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/index.html): Main AURA 2.0 workspace dashboard.
- [`login.html`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/login.html) & [`register.html`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/register.html): AURA 2.0 styled authentication views.
- [`legacy.html`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/legacy.html): Original standalone client-side recommendation engine (at `/ideas`).
- [`public/`](file:///c:/Users/Shaya/OneDrive/Documents/Visual%20Studio%202019/project%202/public): Client-side styles, scripts, and audio capture worklet.

---

## Privacy & Security

- **Server-Held Credentials:** AI API keys remain strictly on the backend.
- **Ephemeral Voice Tokens:** Voice calls upgrade via single-use, 30-second cryptographic tickets.
- **Audio Privacy:** Audio streams are processed live in-memory; **no audio recordings are ever saved to disk**.
- **15-Minute Safeguard:** Live voice calls automatically cap at 15 minutes per session to prevent accidental open microphones or excessive API quota usage.

