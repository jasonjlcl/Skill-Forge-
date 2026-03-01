# Production Readiness Review - AI Chatbot Webapp

Date (baseline): 2026-02-28
Last Updated: 2026-03-01
Reviewer: Staff/Principal Engineering Review (evidence-based)

## Executive Summary

Current state (2026-03-01): the app is production MVP-ready with validated staged promotion. GitHub Actions `workflow_dispatch` runs `#31` (staging) and `#32` (production) both completed successfully on 2026-02-28 UTC.

Top 5 remaining issues to address next:
1. **Observability is still logging-first** (no metrics/tracing/SLO instrumentation).
2. **Governance/privacy controls are incomplete** (retention/export/delete endpoints not implemented).
3. **Resilience/retrieval maturity gaps remain** (no bounded retry/circuit-breaker policy; lexical-hash embedding quality ceiling).
4. **RAG evaluation is still non-blocking in CI** (`continue-on-error: true`), so regressions do not block promotions.
5. **Compliance hardening can be strengthened** (artifact attestations/signing and stricter branch/deploy protection policy).

Major improvements completed since baseline:
- PR1 delivered async error boundaries, LLM output cap/context budgeting enforcement, and DB hot-path indexes.
- PR2 delivered context sanitization/risk tagging, output moderation, and baseline RAG evaluation script + CI job.
- PR4 delivered CI security gates (TruffleHog, CodeQL, Trivy), controlled promotion workflow, smoke testing, and rollback path.
- API container hardening now runs as non-root (`USER app`), and container scan blockers were resolved.

## Readiness Score (0-10)

Final score: **8.4 / 10**

Rubric:
- Security & Privacy: 1.6 / 2.0
- Reliability & Correctness: 1.5 / 2.0
- Observability: 0.9 / 2.0
- Performance & Cost Control: 1.6 / 2.0
- AI Quality & Safety: 1.5 / 2.0
- Deployment/CI/CD/Maintainability modifiers: +1.3 / 2.0

Interpretation:
- Strong production MVP posture with staged promotion and security gates operational.
- Not yet enterprise-ready due to observability, governance/privacy, and horizontal-scale architecture gaps.

## Status Update Since Baseline (2026-03-01)

Resolved since 2026-02-28:
- F-REL-01 async error boundary gap.
- F-REL-02 stream registry durability/horizontal scaling (pending stream requests now stored in shared datastore).
- F-REL-04 versioned migration apply workflow (versioned SQL migrations + tracked apply runner).
- F-PERF-01 and F-PERF-02 output/context budget enforcement.
- F-PERF-04 DB indexing gaps on key hot paths.
- F-AI-01, F-AI-02, and F-AI-03 safety layer + prompt-injection sanitization + RAG eval script.
- F-CI-01 and F-CI-02 CI security scanning and controlled promotion workflow.
- F-DEP-02 container runtime non-root hardening.
- F-DEP-03 and F-MNT-01 documentation drift on architecture/security guidance.

Still open:
- F-OBS-01 and F-OBS-02 metrics/tracing/SLO and chat correlation enrichment.
- F-SEC-02 privacy governance endpoints/retention policy enforcement.
- F-PERF-03 semantic embedding quality upgrade.

## Phase A - Architecture & Data Flow Discovery

## System map (from code)

Frontend entrypoint:
- `client/src/main.tsx`

Backend entrypoint:
- `server/src/index.ts`
- App wiring in `server/src/app.ts`

LLM provider calls:
- `server/src/services/gemini.ts`
- Gemini: `gemini-1.5-flash`
- OpenAI fallback: `gpt-4o-mini`

RAG retrieval:
- Retrieval + vector store orchestration: `server/src/services/vectorStore.ts`
- Embedding implementation: `server/src/services/embeddings.ts` (hashed local embedding)
- Ingestion pipeline: `scripts/ingest.ts`

Chat history/session state:
- Persistent store interface: `server/src/store/types.ts`
- Postgres implementation: `server/src/store/postgresStore.ts`
- In-memory implementation (non-prod fallback): `server/src/store/inMemoryStore.ts`
- `messages` table schema: `server/src/db/schema.ts:35`

Streaming:
- Two-step secure stream flow:
  - `POST /chat/stream/start` (`server/src/routes/chat.ts:72`)
  - `GET /chat/stream?stream_id=...` (`server/src/routes/chat.ts:103`)
- Pending stream state held in memory map: `server/src/services/chatStreamRegistry.ts:18`

Tool/function calling layer:
- None found in backend services/routes.

File upload pipeline:
- No backend upload endpoint found.
- Frontend request helper supports `FormData` (`client/src/lib/api.ts:50`) but no server route consumes multipart data.

## Data flow narrative

1. User authenticates in SPA (`client/src/pages/AuthPage.tsx`) via cookie-based auth endpoints.
2. UI calls `POST /chat/stream/start` with message/module/session hints (`client/src/lib/api.ts`, `server/src/routes/chat.ts:72`).
3. API stores pending request in in-memory registry keyed by `stream_id` (`server/src/services/chatStreamRegistry.ts`).
4. UI opens `EventSource` to `GET /chat/stream?stream_id=...` (`client/src/lib/api.ts`).
5. API consumes pending request, persists user message (`server/src/routes/chat.ts:135`), retrieves context from vector store (`server/src/routes/chat.ts:148`), calls LLM (`server/src/routes/chat.ts:155`), persists assistant message (`server/src/routes/chat.ts:163`), and emits SSE events `meta`, `token`, `done` (`server/src/routes/chat.ts:183+`).
6. UI streams tokens and renders result (`client/src/hooks/useSSEChat.ts`).

PII/data exposure points:
- User email stored in `users` table (`server/src/db/schema.ts`).
- Chat/quiz content stored in DB as plaintext text columns (`server/src/db/schema.ts:35`, `server/src/store/postgresStore.ts:150`).
- Logs written to stdout in JSON (`server/src/middleware/logging.ts`, `server/src/middleware/error.ts`, `server/src/index.ts`).

## Phase B - Run & Verify

Commands executed:
- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run audit`
- `npm run eval:rag`

Results:
- Lint: pass
- Tests: pass
- Build: pass (server + client)
- RAG eval: pass
- Audit: pass at configured threshold, but 1 low vulnerability remains (`qs` advisory)

## Phase C - Findings by Category (Baseline Snapshot 2026-02-28)

Note: Findings below are the original baseline snapshot. Refer to "Status Update Since Baseline (2026-03-01)" for current resolution state.

## Security & Privacy

### F-SEC-01 - CSRF token intentionally readable by JS (double-submit pattern)
Severity: Medium
Evidence:
- `server/src/middleware/csrf.ts:9` (`httpOnly: false`)
Impact:
- Any successful XSS can read CSRF token and increase impact surface.
Recommended fix:
- Keep double-submit if desired, but pair with stronger CSP/XSS hardening and optional rotating anti-CSRF token on auth boundaries.

### F-SEC-02 - Data retention/privacy controls not defined for chat content
Severity: High
Evidence:
- Chat content persistence: `server/src/db/schema.ts:35`, `server/src/store/postgresStore.ts:150`
- No retention/deletion workflow in codebase.
Impact:
- Potential long-term PII retention and compliance risk.
Recommended fix:
- Add retention policy (TTL/archival), user data deletion/export endpoints, and documented policy.

### F-SEC-03 - Local secret hygiene risk observed in runtime env file
Severity: High
Evidence:
- `.env.production` exists locally with real secret material (redacted here).
Impact:
- High blast radius if file is leaked in backups/shares/shell history.
Recommended fix:
- Rotate exposed credentials immediately, keep secrets only in secret manager/CI secrets, avoid local long-lived prod secrets.

## Reliability & Correctness

### F-REL-01 - Async Express handlers lack explicit async error boundary
Severity (baseline): High
Status (2026-03-01): Resolved
Baseline evidence:
- Async route handlers in `server/src/routes/chat.ts` were previously not consistently wrapped, while Express 4 does not automatically forward all async throws.
Current evidence:
- `wrapAsync` helper exists in `server/src/middleware/async.ts`.
- Async handlers are wrapped across routes (for example `server/src/routes/chat.ts`, `server/src/routes/auth.ts`, `server/src/routes/quiz.ts`, `server/src/routes/me.ts`).
Historical impact:
- Provider/vector/db thrown errors could become unhandled failures and destabilize API process.
Resolution:
- Added `wrapAsync()` across async handlers so exceptions flow through `next(err)` into centralized error handling.

### F-REL-02 - Pending stream registry is in-process memory only
Severity: High
Evidence:
- `new Map` in `server/src/services/chatStreamRegistry.ts:18`
Impact:
- Breaks under multi-instance scaling and on process restarts (stream IDs lost).
Recommended fix:
- Move stream request registry to Redis with TTL, or collapse start/get into single authenticated POST stream endpoint.

### F-REL-03 - Provider/vector resilience lacks retries/backoff/circuit-breakers
Severity: Medium
Evidence:
- Single-shot provider calls (`server/src/services/gemini.ts:79`, `server/src/services/gemini.ts:95`)
- Single-shot vector query (`server/src/services/vectorStore.ts:142`)
Impact:
- Temporary upstream blips degrade UX and can increase error rates.
Recommended fix:
- Add bounded retries with jitter for transient classes and per-provider circuit-breaker counters.

### F-REL-04 - Non-deterministic migration workflow for audited environments
Severity: High
Evidence:
- `server/package.json:11` and `server/package.json:12` use `drizzle-kit push`.
Impact:
- Reduced change traceability and rollback confidence.
Recommended fix:
- Move to versioned migrations (`drizzle-kit generate` + checked-in SQL + gated apply).

## Observability

### F-OBS-01 - No metrics/tracing/SLO instrumentation
Severity: High
Evidence:
- Logging present (`server/src/middleware/logging.ts`), health endpoint present (`server/src/services/health.ts`), but no metrics/tracing stack in code/workflows.
Impact:
- Hard to detect latency regressions, token cost spikes, and retrieval quality drift.
Recommended fix:
- Add OpenTelemetry spans around retrieval + provider calls, plus metrics (`latency`, `error_rate`, `token_usage`, `stream_completion_rate`).

### F-OBS-02 - Request logs lack conversation/session correlation ID
Severity: Medium
Evidence:
- Request log fields include `requestId`, method/path/status (`server/src/middleware/logging.ts`), but no `sessionId`/`conversationId` enrichment.
Impact:
- Slower incident triage for chat-specific issues.
Recommended fix:
- Attach and log `sessionId`/`streamId` where available (header/context).

## Performance & Cost Control

### F-PERF-01 - No explicit output token caps in model requests
Severity: High
Evidence:
- OpenAI call has `model`, `temperature`, `messages` only (`server/src/services/gemini.ts:96`), no max token budget.
Impact:
- Cost variance and latency spikes under large prompts.
Recommended fix:
- Add configurable output caps (`LLM_MAX_OUTPUT_TOKENS`) and request budget enforcement.

### F-PERF-02 - Configured RAG context limits are not enforced
Severity: Medium
Evidence:
- Config fields exist: `server/src/config/env.ts:31`, `server/src/config/env.ts:109`
- Prompt builder concatenates full chunk text without trim: `server/src/services/gemini.ts:19`, `server/src/services/gemini.ts:124`
Impact:
- Larger prompt payloads, cost increases, and inconsistent quality.
Recommended fix:
- Enforce `ragMaxContextChars` during context assembly and truncate by score order.

### F-PERF-03 - Embedding implementation is lexical hash vector, not semantic
Severity: Medium
Evidence:
- `server/src/services/embeddings.ts:1-40`
Impact:
- Lower retrieval relevance/grounding versus production embedding models.
Recommended fix:
- Introduce semantic embedding provider (e.g., Vertex/OpenAI) with caching and batch ingestion.

### F-PERF-04 - DB indexing gaps for chat message retrieval paths
Severity: Medium
Evidence:
- `listMessages` queries by `sessionId` ordered by `createdAt` (`server/src/store/postgresStore.ts:163-169`)
- `messages` table has no explicit index on `(session_id, created_at)` (`server/src/db/schema.ts:35`)
Impact:
- Query degradation at scale.
Recommended fix:
- Add composite index(es) for hot paths (`messages(session_id, created_at)`, similar for attempts/answers).

## AI Quality & Safety

### F-AI-01 - No moderation/safety filter stage before returning model output
Severity: High
Evidence:
- Chat route directly emits model completion to user (`server/src/routes/chat.ts:155`, `server/src/routes/chat.ts:199`)
- Services folder has no moderation component (`server/src/services/*`).
Impact:
- Unsafe or policy-violating outputs may reach users.
Recommended fix:
- Add output safety check/moderation policy gate before SSE emit.

### F-AI-02 - Prompt injection defenses are minimal
Severity: High
Evidence:
- User question and retrieved context are directly concatenated into prompt (`server/src/services/gemini.ts:134-138`)
Impact:
- Retrieved malicious text can influence behavior without robust isolation/allowlist policies.
Recommended fix:
- Add instruction hierarchy, contextual sanitization, retrieval trust tags, and strict schema validation for any tool expansion.

### F-AI-03 - RAG eval hook referenced but missing in repo
Severity: Medium
Evidence:
- Script declared: `package.json:29` (`eval:rag`)
- File missing: `scripts/eval-rag.ts`
Impact:
- No practical regression gate for retrieval quality.
Recommended fix:
- Add the missing evaluator script and baseline dataset checks in CI (non-blocking first, then gating).

### F-AI-04 - Streaming is replayed tokenization, not true provider token stream
Severity: Medium
Evidence:
- Full completion first (`server/src/routes/chat.ts:155`), then token split + sleep replay (`server/src/routes/chat.ts:199`, `server/src/routes/chat.ts:208`)
Impact:
- Added latency and less accurate realtime UX.
Recommended fix:
- Adopt provider-native streaming and pass-through SSE chunks.

## Deployment & Configuration

### F-DEP-01 - CSP/font configuration mismatch
Severity: Medium
Evidence:
- Google Fonts import: `client/src/index.css:1`
- CSP disallows remote fonts/scripts/styles outside self: `infra/nginx/default.http.conf.template:12`, `infra/nginx/default.https.conf.template:41`
Impact:
- Fonts blocked in production; avoidable UX inconsistency.
Recommended fix:
- Self-host fonts or update CSP explicitly to trusted font/style domains.

### F-DEP-02 - Container runtime user hardening missing
Severity: Medium
Evidence:
- No `USER` directive in `server/Dockerfile`.
Impact:
- Larger blast radius if container compromised.
Recommended fix:
- Run as non-root UID/GID, minimize filesystem write permissions.

### F-DEP-03 - Documentation drift on chat transport and security behavior
Severity: Low
Evidence:
- README still shows old stream pattern `GET /api/chat/stream?message=...` (`README.md:56`)
- Current implementation is `POST /stream/start` + `GET /stream?stream_id` (`server/src/routes/chat.ts:72`, `server/src/routes/chat.ts:103`)
Impact:
- Integration mistakes and operational confusion.
Recommended fix:
- Update README/API docs to current transport and CSRF behavior.

## CI/CD

### F-CI-01 - CI missing secret scanning / SAST / container vulnerability scan
Severity: High
Evidence:
- Current workflow runs audit/lint/test/build/docker build only (`.github/workflows/ci-cd.yml`).
Impact:
- Reduced early detection for secret leaks and image vulnerabilities.
Recommended fix:
- Add gitleaks/trufflehog, CodeQL/SAST, Trivy/Grype image scan stages.

### F-CI-02 - Deployment workflow is manual template only
Severity: Medium
Evidence:
- `deploy-template` job only prints instructions (`.github/workflows/ci-cd.yml:88+`).
Impact:
- No standardized promotion gates/approval/rollback automation.
Recommended fix:
- Add environment-specific deploy jobs with approval rules and automated post-deploy smoke tests.

## Maintainability

### F-MNT-01 - README security and env guidance partially stale
Severity: Low
Evidence:
- README says JWT minimum 16 chars (`README.md:108`), runtime enforces 32 (`server/src/config/env.ts:6`, `server/src/config/env.ts:72`).
Impact:
- Team confusion and avoidable misconfiguration.
Recommended fix:
- Align README/env docs to runtime validation.

## What is already strong

- Production fail-fast dependency checks:
  - `server/src/index.ts:11`
  - `server/src/config/env.ts:68,94`
  - `server/src/store/index.ts:15`
  - `server/src/services/vectorStore.ts:183`
- Auth hardening (lockout, token version revocation, per-auth rate limit):
  - `server/src/routes/auth.ts`
- CSRF enforcement on protected mutating routes:
  - `server/src/middleware/csrf.ts`
  - chat/quiz/auth routes
- Security headers and global rate limiting:
  - `server/src/app.ts`
- Structured logging with request IDs:
  - `server/src/middleware/logging.ts`
- CI quality gate + dependency audit:
  - `.github/workflows/ci-cd.yml`

## Now / Next / Later Roadmap (Updated 2026-03-01)

Now (1-3 weeks, highest impact)
- PR3: add metrics/tracing/SLO skeleton and chat correlation fields (`sessionId`, `streamId`).
- PR5: implement governance/privacy controls (retention, user export/delete endpoints, audit trail events).
- Move `rag-eval` from non-blocking to policy-gated once baseline stability is proven.

Next (3-8 weeks)
- Add bounded retry/backoff and circuit-breaker policy for provider/vector dependencies.
- Upgrade retrieval quality with semantic embedding provider and cache/batch ingestion strategy.
- Tighten deployment compliance posture (attestations/signing, protected deployment policies, stricter branch protections).

Later (8+ weeks)
- Move RAG eval from non-blocking to policy-gated once baseline is stable.
- Define and enforce target SLOs with paging thresholds and error-budget policy.
- Extend governance controls to include scheduled data lifecycle jobs and compliance reporting.

## Minimum Safe-to-Ship Baseline Checklist

- [x] Lint/test/build passing in CI
- [x] Auth cookie + CSRF + lockout + token revocation
- [x] Production fail-fast on missing DB/Chroma/JWT secret
- [x] URL query values not logged by backend logger
- [x] Async route errors centrally captured without process instability
- [x] LLM output token caps and context budget enforcement
- [x] Basic safety/moderation gate before user-visible output
- [x] DB indexes for message/session hot paths
- [x] CI secret scanning + container vuln scanning
- [x] Staged deploy with environment approvals and smoke validation
- [x] Versioned migrations with approval gates
- [x] Stream registry durable across replicas/restarts
- [ ] Metrics/traces/SLO alerting in production
- [ ] Governance privacy endpoints (export/delete/retention)

## Phase D - Summary of modifications made in this review

Implemented in baseline review:
- `server/src/middleware/logging.ts` - sanitize logged URL path (drop query values)
- `server/src/middleware/error.ts` - sanitize logged URL path (drop query values)
- `server/src/config/env.ts` - add `LLM_TIMEOUT_MS` and `llmTimeoutMs`
- `server/src/services/gemini.ts` - add timeout wrapper around Gemini/OpenAI calls
- `.env.example` / `.env.production.example` - add `LLM_TIMEOUT_MS`
- `docker-compose.prod.yml` - pass `LLM_TIMEOUT_MS` to API container

Additional implemented through 2026-03-01:
- PR1 (reliability/cost): async wrapper, output/context guardrails, DB indexes, tests.
- PR2 (AI safety/RAG): output moderation, prompt-injection sanitization/tagging, `scripts/eval-rag.ts`, CI rag-eval job.
- PR4 (CI/CD): TruffleHog + CodeQL + Trivy gates, staged approvals, smoke test, rollback automation.
- Stream request durability: moved pending stream request handling from in-process map to shared datastore persistence.
- Migration control: replaced runtime `drizzle-kit push` usage with versioned SQL migration runner (`server/scripts/migrate.ts`) backed by `schema_migrations`.
- Container hardening: API runtime switched to non-root user.
- Deployment validation: successful staging + production promotions (`run #31` and `run #32` on 2026-02-28 UTC).

Validation after changes:
- `npm run lint` passed
- `npm run test` passed
- `npm run build` passed
- `npm run eval:rag` passed
- `npm run audit` passed (1 low advisory remains: `qs`)
