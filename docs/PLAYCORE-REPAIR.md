# ZUNO PLAYCORE repair — 25 October 2026

## What was wrong

The Study Studio card and sidebar button had no navigation handlers, page, API integration or service deployment. Open Notebook's image had been downloaded but no Study Studio service was running. The mascot state controller changed CSS on a static JPEG; ZUNO Live still rendered a faceless orb. The supplied JPEG contains a background and wordmark, not separable facial layers.

## Implemented

- Native `/study` page, preserving the existing dashboard. Both dashboard entry points open it.
- Real notebooks: create, recent ordering, reopen, rename and confirmed deletion. Local ownership mappings and study chat history persist in additive SQLite tables.
- PDF, TXT and Markdown uploads (15 MB), actual transfer progress and upstream processing status. Extracted text inspection, notes, title/text filtering within the authorized notebook, and saving answers as notes.
- Questions and summaries through Open Notebook's real context/session/chat APIs. Backend constructs context from authorized IDs; browser cannot submit remote IDs, context, model selection or sessions. No fallback to regular companion chat.
- Citation markers returned by the model resolve only to authorized material included in that request. Unrecognized references are omitted. Sources open as extracted text, not fabricated page citations. Reference validity does not prove factual entailment.
- Study tasks use the existing scheduler and reminders, persist in `schedule_tasks`, and link back from the planner. Deleting a notebook preserves its planner tasks.
- Shared expressive character in the hero and Live panel, with editable SVG eyes, eyebrows, smile, speech mouth, cheeks and rings. **This is a vector interpretation of the provided artwork**, not a transparent extraction of the original. Original JPEG is preserved for brand/logo use.
- Actual audio output RMS drives mouth opening, microphone PCM RMS drives the listening indicator. This is amplitude animation, not phoneme lip synchronization.

## Running locally

Requires Node 20.19+ and Docker Desktop running Linux containers. Do not replace your existing `.env` or database.

```powershell
npm install
npm run study:setup
# Set STUDY_OWNER_ID in .env to the existing account ID if setup cannot select a sole account.
docker compose -f deploy/compose.yml --env-file deploy/.env up -d
npm run study:model
npm start
```

Open `http://localhost:3000/chat` or `http://localhost:3000/study` and sign in. The account specified by the user was verified by email in the existing database and configured as owner. Other accounts and data were preserved.

`study:setup` generates secrets once in ignored `deploy/.env`, copies only the selected existing provider keys, and appends missing service configuration to `.env`. It does not print keys. If there are multiple accounts it does not guess the owner. Provider key rotation requires rerunning setup and `docker compose ... up -d`. Changing the encryption key makes stored upstream credentials unreadable; retain it with your backups.

Required ZUNO variables: existing `JWT_SECRET` and provider settings; plus `STUDY_ENABLED=true`, `STUDY_OWNER_ID=<existing numeric account ID>`, `OPEN_NOTEBOOK_URL=http://127.0.0.1:5055`, and `OPEN_NOTEBOOK_PASSWORD` matching the service. `PORT` remains 3000 by default. Set `STUDY_ENABLED=false` to disable this feature.

Service variables: `OPEN_NOTEBOOK_PASSWORD`, `OPEN_NOTEBOOK_ENCRYPTION_KEY`, `SURREAL_PASSWORD`, and at least one of `NVIDIA_API_KEY` / `GEMINI_API_KEY`. Model bootstrap uses NVIDIA when available, otherwise Google. The deployment uses the upstream legacy environment-key fallback; migration to encrypted upstream credentials is a future maintenance task.

## Architecture and upstream contract

Browser → authenticated ZUNO `/api/companion/study` routes → Open Notebook FastAPI → SurrealDB and persistent source files. Existing chat, Gemini Live voice, planner and rewards remain separate.

Pinned and live-tested images (also digest-pinned in Compose):

- Open Notebook **1.15.0**, digest `54b2025a4a4853c188f74b9b8246eca8c5480e5dd1babfa92db1038ff2f30212`.
- SurrealDB **2.3.10**, digest `e3322f21b3135dd4893e6487874481333b03bc731d7da200d716a8564b4f0a92`.

Upstream sources examined: [release source](https://github.com/lfnovo/open-notebook/tree/v1.15.0), [auth middleware](https://github.com/lfnovo/open-notebook/blob/v1.15.0/api/auth.py), [sources API](https://github.com/lfnovo/open-notebook/blob/v1.15.0/api/routers/sources.py), [chat API](https://github.com/lfnovo/open-notebook/blob/v1.15.0/api/routers/chat.py), [context builder](https://github.com/lfnovo/open-notebook/blob/v1.15.0/open_notebook/utils/context_builder.py). MIT attribution/license retained in `third-party/OPEN-NOTEBOOK-LICENSE` and the Study Studio footer.

Supported calls used: `/health`; `/api/notebooks` and `/{id}`; multipart `/api/sources` and `/api/sources/{id}`; `/api/notes`; `/api/chat/context`, `/api/chat/sessions`, `/api/chat/execute`; `/api/models` and `/api/models/defaults`. Fresh upstream chat sessions per question prevent stale source context; ZUNO stores the visible study exchanges. No global search endpoint is exposed because it would search beyond one authorized notebook.

## Data and security boundary

- **Local single-owner preview, not production multi-user tenancy.** Open Notebook authenticates with one shared password, not a ZUNO user's identity. Only the configured ZUNO account can reach the integration. Every notebook lookup additionally checks ownership server-side. Switching the configured owner does not grant access to previous-owner notebooks.
- Backend credentials never go to browser code. There is no arbitrary API proxy or client-supplied upstream resource ID. Outbound service URL must be loopback. API errors do not echo provider/service payloads.
- Open Notebook API binds `127.0.0.1:5055`; its admin UI and SurrealDB are not published. Keep ZUNO itself local; do not publish this preview through a tunnel or reverse proxy. Existing JWT/auth behavior is preserved, not certified for public deployment.
- Separate Docker volumes `zuno-study_study-database` and `zuno-study_study-files`. Existing `vibeai.db` stores ownership/task links and history only. Back up both volumes, database and private service configuration together. Never use `docker compose down -v` on data you want to keep.
- Study context is sent to the configured AI provider when asking questions/summaries. Upload extraction is handled by Open Notebook. No heavyweight OCR/model runtime is enabled.
- Remote creation and local SQLite mapping cannot be atomic across two services. A crash between them may leave an upstream orphan; no automatic sweeping of unknown data is performed.

## Character event mapping

| State | Trigger |
| --- | --- |
| Idle | No active interaction; call ended or microphone muted without playback |
| Listening | Microphone capture connected and unmuted |
| Thinking | Pending text request, received model transcription before audio, finished user transcription or scheduler tool processing |
| Speaking | Scheduled/playing real PCM output; mouth amplitude from output analyser |
| Happy | Successful text response |
| Excited | Actual saved movie reward revealed |
| Comforting | Explicit mood cue in the user's message |
| Task completed | Confirmed planner completion/reward event |
| Error | Chat failure, provider/network failure, microphone denial, playback error or connection timeout |

One centralized controller prioritizes channels, clears them on page exit, and uses short timers only to retire reactions (not to pretend a call is active). Audio nodes, tracks, animation frames, polling and requests are cleaned up. Reduced-motion disables character animation; Focus Mode calms visuals while keeping controls usable.

## Verification

```powershell
npm test
# Uses real running Open Notebook and configured provider; small provider requests may consume quota:
npm run test:study:live
docker compose -f deploy/compose.yml --env-file deploy/.env ps
```

Baseline: 4 test groups passed before repair. Current automated suite: 5 groups passed, including auth, account boundaries, chat, simulated-provider voice lifecycle and voice-to-task creation, task persistence, planner, rewards, mascot event states, face visibility, blink animation, error recovery, reduced motion and mobile overflow. Citation unit test rejects unknown source references.

Live integration test passed against actual Open Notebook/NVIDIA: both navigation entries, create/reload/restart persistence, TXT and real PDF extraction, document-specific question with secret test marker, source citations and inspection, summary, notes, rename, planner persistence, ownership checks independent of the owner gate, offline errors, mobile layout and confirmed delete. Test accounts and ZUNO database are isolated; test-created remote notebooks are removed.

Real Gemini Live smoke check returned audio. **Not manually verified:** physical microphone/headphone conversation quality, human interruption timing, Hindi/Hinglish pronunciation and long-duration calls. Browser voice tests use synthetic microphone and provider fixtures; they are not evidence of real-world latency. Scanned/image PDFs requiring OCR, huge documents and provider quota exhaustion are not end-to-end tested.

## Limits and troubleshooting

- No vector/semantic search or embedding model is configured. Chat sends full authorized notebook content, capped at 180,000 serialized characters; split larger material into smaller notebooks. Maximum 50 notebooks and 30 material items per notebook.
- Search is a title/text filter over the selected authorized notebook, not a cross-notebook semantic search. Source viewer displays extracted text, not page-accurate PDF highlights.
- Study questions are independent grounded turns; previous answers remain visible but are not silently included as document evidence. Summary uses the same supported chat route.
- Offline: start Docker Desktop, run Compose, check `docker compose ... ps`. ZUNO chat/planner remain independent. Check service password consistency for authentication errors.
- Processing stuck/failed: check local service logs privately, ensure the document contains extractable text, and try a TXT version or a fresh notebook. Do not paste logs containing provider credentials into public issues.
- AI failure: run `npm run study:model`; check provider key/quota/model access. Uploaded material is not replaced with a generic companion response.
- Next: dedicated per-user upstream isolation before public access; automated backup/restore and cross-service orphan recovery; broader OCR and large-document retrieval testing.

## Files and rollback

New: `study.js`, `study.html`, `public/study.js`, `public/study.css`, `public/mascot.js`, `public/mascot.css`, `deploy/compose.yml`, `deploy/.env.example`, `scripts/setup-study.cjs`, `scripts/configure-study-model.cjs`, `tests/study-live.cjs`, `tests/study.test.cjs`, this report.

Updated: `database.js`, `server.js`, `companion.js`, `scheduler.js`, `index.html`, `public/companion.js`, `public/playcore.js`, `public/scheduler.js`, `package.json`, `.gitignore`, `.env.example`, README and architecture guide. Private `.env` and ignored `deploy/.env` were configured locally, never staged.

Repair branch: `playcore-repair`. Pre-repair code checkpoint: `af42fad`; original pre-PLAYCORE tag: `pre-playcore-2`. Code rollback should use a separate worktree/branch after preserving current work. Do not roll back or overwrite the existing user database merely to revert UI code; new tables are additive.

## Follow-up: chat task reliability (26 October 2026)

Reported: tasks asked for in chat were sometimes not saved, deadlines landed on the wrong day, and replies occasionally failed or the server stopped.

Cause: small chat models answer "done, I added it" without calling a tool, or send a natural-language deadline (`tomorrow at 6pm`) that the old ISO-only validator rejected. `tomorrow` was also being interpreted against end-of-day rather than the user's zone, and a provider hiccup or a locked database file surfaced as a failed reply.

Changes:

- `scheduler.js` resolves deadlines on the server in the user's timezone. It accepts ISO 8601 with or without an offset plus English/Hinglish phrases (`tomorrow`, `kal`, `parso`, `tonight`, `Friday`, `next Monday`, `30 October`, `30/10`, `in 2 hours`, `5 baje`, `shaam/subah/raat`, `6pm`, `18:00`). Tools now take `when` (the user's own words) instead of making the model do date arithmetic.
- `chat-provider.js` adds a forced `add_tasks` round when the user asks to add something, 45 s timeouts, transient retry for timeouts/429/5xx, and response-shape validation.
- `companion.js` tracks real tool results. If the reply claims a save but nothing was stored, it retries once with a forced `add_tasks`; if that also fails it states honestly that nothing was added. Confirmations list the actual stored title and deadline. A deadline the model invented is dropped when the user never mentioned a time.
- `database.js` writes through a temp file with retry (the database lives in a synced folder where the file can be briefly locked) and rolls back safely.
- `server.js` logs stray rejected promises instead of letting them terminate the process and returns JSON errors for API failures.
- `public/radio.js` opens the in-dashboard Study shell even when no playlist is loaded.

Verification: `npm test` covers natural-language deadlines, a false "done" reply that must be recovered, an unsavable task that must report failure, forced-tool mapping, transient retry, ISO-without-offset, timezone persistence and the existing browser/voice/planner/Radio suites. Study Studio was re-verified against the running services: status, notebook list, completed PDF source and a grounded model answer with citations.

Study Studio needs Docker Desktop running. Both Compose services use `restart: unless-stopped`, so they return automatically once Docker starts; `npm run study:setup` and `npm run study:model` are only needed for a fresh machine or a new model.
