# Production deployment handoff

Active scope: finish existing Vercel Hobby + Supabase deployment. No license changes, paid resources or full test suite. Owner approved committing/pushing deployment-critical changes after successful live verification.

Confirmed:
- Existing Vercel project: `zuno`; CLI 65.4.0 authenticated as `crafton47`. Hobby plan confirmed. GitHub `Crafton47/ZUNO`, production branch `main`, already linked.
- Supabase connection succeeds; all 19 tables exist. Migration not rerun.
- Private source/SQLite checkpoint created under `%LOCALAPPDATA%/ZunoDeployCheckpoint-*` before changes. No live data deleted.
- DNS PR https://github.com/zordhalo/runs-on.dev/pull/395 is OPEN. Domain currently serves a runs-on.dev profile, not ZUNO.
- Local uncommitted API entrypoint work preserved, then corrected to export Express app instead of HTTP Server.
- Existing PostgreSQL adapter did not await planner/Radio queries or create real transactions. Fixed with transaction-scoped clients, an asynchronous planner persistence adapter sharing existing validation, and awaited Radio/chat-tool operations.
- Vercel static output now contains only browser files; API exports Express and explicit nested API rewrites prevent 404s. API initialization retries after transient failure.
- Existing production DB/JWT/provider configuration privately compared to local configuration; values match. No values printed or committed.

## Verified production result

Public URL: https://zuno-woad.vercel.app

Verified production deployment: `dpl_858PkwUzKrNyXyqq4bA7M594hJtu`, READY. Custom domain remains unverified pending PR #395; user confirmed `zuno.runs-on.dev` (with the s).

Focused checks, 27 October 2026:
- Local production-mode smoke against real Supabase: registration/login, profile, missions, completion rewards, reminders/calendar, Radio writes, real AI reply and persisted conversation passed.
- Same smoke against public Vercel URL: all checks passed after repairing nested API routing. Synthetic accounts and their records were removed; existing user data was untouched.
- Browser smoke at 390px: root redirects to working login, password form visible, no horizontal overflow or page errors. Public dashboard/Study shell/assets return HTTP 200.
- Requests for `.env`, `database.js`, and `vibeai.db` returned HTML fallbacks, not configuration, source or database bytes.
- PostgreSQL rollback probe passed. Existing schema had no tables readable by anonymous role without RLS.
- Two focused existing provider tests passed; deployment files passed ESLint/syntax checks. Full suite intentionally not run.

## Remaining limitations / owner actions

- DNS maintainer must merge https://github.com/zordhalo/runs-on.dev/pull/395; no duplicate PR created. Domain is already attached to the existing Vercel project.
- Live voice's persistent WebSocket proxy cannot run as a Vercel Function. Smallest hosting-free architectural alternative is direct browser-to-Gemini Live with short-lived provider tokens and authenticated server-side planner actions; not implemented or verified in this deployment.
- Open Notebook/SurrealDB require persistent services; no verified free, laptop-independent host is configured. Study/Exam Rescue show explicit unavailable status, with local implementations/data preserved. No claim that all features are live.
- YouTube embedded playback follows browser policy; actual playback not verified in this pass. Metadata key not configured in Vercel; playlist persistence works.
- Vercel Hobby confirmed; Supabase connectivity confirmed, but its Free billing tier is known only from the handoff, not an authenticated billing dashboard. No paid resource/subscription activated; provider quotas remain external.
- Vercel plugin installer reported Codex installation complete. Shared MCP endpoint configured at `https://mcp.vercel.com`, but separate OAuth consent remains pending; CLI deployment does not depend on it.
- Application request limits remain instance-local; this deployment does not claim distributed abuse-control guarantees.

Platform limitations: persistent voice WebSocket proxy and Docker Open Notebook/SurrealDB cannot run unchanged as Vercel Functions. Preserve local features and return explicit unavailable status in cloud. No Redis needed for basic deployment. Billing tier and real AI request verification still pending.
