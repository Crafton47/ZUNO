# ZUNO 2.0 — Security Audit Report

**Date:** 27 October 2026
**Auditor:** Antigravity (taking over from Astra)
**Status:** COMPLETED & VERIFIED
**Target:** ZUNO PLAYCORE 2.0 (`playcore-repair` branch)

---

## 1. Executive Summary

A comprehensive security audit of ZUNO 2.0 was conducted covering authentication, session handling, authorization, rate limiting, file upload handling, output sanitization, HTTP security headers, data persistence atomicity, and repository secret hygiene.

All high-severity vulnerabilities identified during initial reconnaissance have been remediated in code and validated with dedicated automated security regression test suites (`tests/release-security.test.cjs`) and git history secret scans (`scripts/scan-secrets.cjs`).

---

## 2. Detailed Findings & Remediations

### 2.1 Authentication & JWT Handling
- **Previous Defect:** `server.js` previously accepted weak or fallback JWT signing secrets (e.g., `'vibe-companion-secret'` or strings shorter than 32 characters), risking offline brute-force attacks and token forgery.
- **Remediation (`security.js`, `server.js`):**
  - Implemented `signingSecret()` in `security.js`.
  - Requires `JWT_SECRET` to be defined and strictly `>= 32 bytes`.
  - Rejects known placeholder patterns (`replace-with-a-long-random-secret`, `vibe-companion-secret`, `your-secret-key`, etc.).
  - Fails closed on startup before creating any database or binding to any port if secret is invalid or missing.
  - Verification with `jwt.verify` strictly limits accepted algorithms to `HS256`, enforces token expiration, and validates user ID existence against the SQLite store.
  - Sensitive authentication endpoints return identical error messages and status codes (HTTP 401) for unknown usernames and incorrect passwords to prevent user enumeration.

### 2.2 Rate Limiting & Denial-of-Service Protections
- **Previous Defect:** Authentication routes (`/api/login`, `/api/register`) lacked throttling, leaving the system vulnerable to brute-force credential stuffing and password guessing.
- **Remediation (`security.js`, `server.js`):**
  - Implemented in-memory sliding window rate limiter in `security.js` with zero external dependencies.
  - Applied dual-layer throttling:
    1. **IP-based Rate Limiter:** 60 requests per 15-minute window per IP.
    2. **Account Identifier Limiter:** 15 requests per 15-minute window per hashed account identifier (`sha256(ip + email/username)`).
  - DoS resistance: Memory map bounded with maximum key cap (`maxKeys: 10000`) and automatic LRU/expired entry eviction to prevent heap exhaustion attacks.
  - Safe IP extraction: Uses direct socket IP address rather than trusting unverified `X-Forwarded-For` headers without an upstream trusted reverse proxy configuration.

### 2.3 Authorization & Ownership Boundaries
- **Ownership Controls (`study.js`, `companion.js`, `scheduler.js`):**
  - Study Studio is explicitly architected as a single-owner learning workspace gated behind `STUDY_OWNER_ID`.
  - All notebook operations, material uploads, flashcards, quizzes, study tasks, and XP allocations verify that the authenticated `req.user.id` matches the authorized owner ID. Non-owner requests are rejected with HTTP 403 Forbidden.
  - Companion messages, tasks, reminders, and profile memory notes are strictly scoped to `WHERE user_id = ?` in all database queries. Users cannot inspect or manipulate other users' data.

### 2.4 File Uploads & Path Traversal Protections
- **Upload Pipeline (`study.js`):**
  - Multer middleware enforces strict file limits (max 50MB per document).
  - Filenames are sanitized and mapped to randomized internal storage keys (`study-files` storage volume / directory).
  - Accepted MIME types and file extensions are restricted to `.pdf`, `.txt`, `.md`.
  - Direct executable file uploads (`.exe`, `.sh`, `.bat`, `.js`, etc.) are blocked.
  - Uploaded files are served through controlled stream handlers or forwarded directly to Open Notebook's isolated container API without exposing filesystem paths.

### 2.5 AI Prompt Injection & Output Sanitization
- **Grounded AI Boundaries:**
  - Study Studio queries use grounded retrieval-augmented generation (RAG) against the Open Notebook workspace with strict system prompts separating system instructions from untrusted user content.
- **Output Sanitization (`public/study.js`):**
  - Replaced all raw AI HTML string injection (`innerHTML = aiResponse`) with a safe, built-in Markdown renderer.
  - Markdown renderer escapes HTML entities (`&`, `<`, `>`, `"`, `'`) before parsing formatting tokens (bold, italics, code blocks, tables, blockquotes, lists).
  - URLs in generated links are checked against an allowlist of protocols (`http:`, `https:`), preventing `javascript:` URI injection.

### 2.6 HTTP Security Headers & Cross-Origin Policies
- **Headers Configured (`server.js`):**
  - **Clickjacking & Framing Controls:**
    - API routes (`/api/*`): Enforce `X-Frame-Options: DENY` and `Content-Security-Policy: ... frame-ancestors 'none'`.
    - View routes (`/`, `/study`, `/chat`): Enforce `X-Frame-Options: SAMEORIGIN` and `Content-Security-Policy: ... frame-ancestors 'self'`. This prevents external third-party sites from clickjacking or embedding ZUNO, while allowing the `/chat` dashboard to securely embed the internal Study Studio iframe.
  - `X-Content-Type-Options: nosniff`
  - `Cache-Control: no-store` on all `/api/*` authenticated endpoints
  - Removed `X-Powered-By: Express` header to minimize server fingerprinting.
  - Request body parser limited to 100kb (`express.json({ limit: '100kb' })`) to prevent JSON payload flooding.

### 2.7 Database Persistence Atomicity & Failure Rollback
- **Previous Defect:** In `database.js`, write operations that failed during background disk flush (`saveToDisk()`) logged the error but returned success to callers, creating a silent discrepancy between memory and disk.
- **Remediation (`database.js`):**
  - Disk synchronization writes to a temporary file (`vibeai.db.tmp-<id>`) followed by atomic rename (`fs.renameSync`) with up to 4 bounded retries for Windows file lock contention.
  - On exhausted retry failure, the in-memory database is rolled back to the last known `durableSnapshot` and an error is thrown, propagating HTTP 503 Service Unavailable to the caller rather than claiming false success.

---

## 3. Secret & Credential Scanning

A full scan of the active working tree and the entire Git history was executed via `scripts/scan-secrets.cjs`:

```bash
$ node scripts/scan-secrets.cjs --history
Scanning working tree (232 files)...
Scanning git history (159 blobs)...
Findings: 0
Result: PASS
```

- **Working Tree:** No live API keys, JWT secrets, passwords, or private keys detected.
- **Git History:** 159 git commit blobs scanned; zero committed secrets found.
- `.env` and `deploy/.env` are properly ignored by `.gitignore`.
- `.env.example` contains only benign, documented placeholders.

---

## 4. Architecture Security Boundary & Limitations

### Single-Owner Open Notebook Service Boundary
- **Service Stack:** Open Notebook 1.15.0 and SurrealDB 2.3.10 run locally inside Docker (`deploy/compose.yml`) listening on internal port 5055.
- **Security Boundary:** Open Notebook is an internal upstream service with a shared service password. It does NOT implement multi-tenant data isolation.
- **Protection Policy:**
  - The Node.js application acts as the security gateway, enforcing `STUDY_OWNER_ID` on every request.
  - Open Notebook port 5055 **must never be exposed directly to the public Internet**.
  - For remote deployments, access must be secured behind a reverse proxy (e.g. Nginx/Caddy) with HTTPS and VPN/firewall rules limiting port 5055 to localhost.

---

## 5. Security Verdict

| Audit Domain | Status | Notes |
| :--- | :--- | :--- |
| JWT Secret Validation | **PASS** | >=32 bytes enforced; placeholders rejected |
| Auth Rate Limiting | **PASS** | Dual IP (60/15m) and Account (15/15m) throttling active |
| Resource Ownership Gates | **PASS** | STUDY_OWNER_ID enforced on Study Studio; user_id on companion |
| AI Output Sanitization | **PASS** | Safe markdown parser; no unescaped innerHTML |
| HTTP Security Headers | **PASS** | Strict CSP, nosniff, DENY, no-store |
| Database Persistence Atomicity | **PASS** | Atomic tempfile rename + rollback snapshot on failure |
| Secret Scanning | **PASS** | 0 secrets found in working tree or git history |
| **OVERALL SECURITY VERDICT** | **PASSED** | Ready for release with single-owner deployment model |
