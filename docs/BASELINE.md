# Phase 0 baseline

Checkpoint: Git tag `pre-playcore-2`, branch `playcore-2`, commit `125f553`. Existing SQLite and .env are excluded from Git and have not been replaced.

Actual stack: CommonJS Node/Express, vanilla browser JS, sql.js SQLite, Gemini live WebSocket, NVIDIA/Gemini text provider. Entry: server.js, index.html. Authentication pages retain their existing endpoints and localStorage keys.

Baseline: npm test passed 4 test groups covering registration/login, text provider adapter, simulated voice lifecycle and voice task actions, planner CRUD/persistence, account isolation, rewards, reminders, and mobile sizing. No live AI call was made in this baseline phase. Documentation named AURA, while the requested product name is now ZUNO. Actual scheduler tables are schedule_tasks/actions/reminders, not the companion_tasks schema claimed by the old guide.

Upstream audit: Open Notebook v1.15.0, MIT license, FastAPI backend, Next.js frontend, SurrealDB storage plus local files and SQLite chat checkpoints. Shared bearer password, not per-user authorization. Integration must never forward arbitrary upstream IDs, context, credentials or routes from a browser. No iframe or source merge. A local-owner gate remains in place until public multi-user deployment is independently audited.

User supplied official logo: public/brand/zuno-logo.jpeg (copied unchanged). This replaces the missing-mascot placeholder assumption.
