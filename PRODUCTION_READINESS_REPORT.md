# Production Readiness Review - AI Chatbot Webapp

Date (baseline): 2026-02-28
Last Updated: 2026-03-01
Reviewer: Staff/Principal Engineering Review (evidence-based)

## Executive Summary

Current state (2026-03-01): the app is production MVP-ready with validated staged promotion. GitHub Actions `workflow_dispatch` runs `#31`/`#32` (2026-02-28 UTC) and `#41` (2026-03-01 UTC) completed successfully through production deployment and smoke verification.
Deployment model: promotion is SSH-based and host-agnostic (`scripts/prod/deploy-remote.sh`), which is compatible with Linux VM targets such as GCP Compute Engine when SSH/Docker prerequisites are met.

Top 5 remaining issues to address next:
1. **Governance/privacy controls are incomplete** (retention/export/delete endpoints not implemented).
2. **RAG evaluation is still non-blocking in CI** (`continue-on-error: true`), so regressions do not block promotions.
3. **Streaming UX is replay-based, not provider-native token streaming yet**.
4. **Compliance hardening can be strengthened** (artifact attestations/signing and stricter branch/deploy protection policy).
5. **Observability still needs production operationalization** (exporters/dashboards/SLO alerting on top of newly added instrumentation).

Major improvements completed since baseline:
- PR1 delivered async error boundaries, LLM output cap/context budgeting enforcement, and DB hot-path indexes.
- PR2 delivered context sanitization/risk tagging, output moderation, and baseline RAG evaluation script + CI job.
- PR4 delivered CI security gates (TruffleHog, CodeQL, Trivy), controlled promotion workflow, smoke testing, and rollback path.
- API container hardening now runs as non-root (`USER app`), and container scan blockers were resolved.

## Readiness Score (0-10)

Final score: **9.0 / 10**

Rubric:
- Security & Privacy: 1.6 / 2.0
- Reliability & Correctness: 1.7 / 2.0
- Observability: 1.1 / 2.0
- Performance & Cost Control: 1.8 / 2.0
- AI Quality & Safety: 1.5 / 2.0
- Deployment/CI/CD/Maintainability modifiers: +1.3 / 2.0

Interpretation:
- Strong production MVP posture with staged promotion and security gates operational.
- Not yet enterprise-ready due to governance/privacy, full observability operationalization, and remaining compliance gaps.

## Status Update Since Baseline (2026-03-01)

Resolved since 2026-02-28:
- F-REL-01 async error boundary gap.
- F-REL-02 stream registry durability/horizontal scaling (pending stream requests now stored in shared datastore).
- F-REL-03 resilience policy gaps (retry/backoff/circuit-breakers).
- F-REL-04 versioned migration apply workflow (versioned SQL migrations + tracked apply runner).
- F-OBS-01 metrics/tracing/SLO baseline instrumentation.
- F-OBS-02 request log correlation enrichment (`sessionId`, `streamId`).
- F-PERF-01 and F-PERF-02 output/context budget enforcement.
- F-PERF-03 semantic embedding provider integration (OpenAI + batching/cache, non-prod fallback).
- F-PERF-04 DB indexing gaps on key hot paths.
- F-AI-01, F-AI-02, and F-AI-03 safety layer + prompt-injection sanitization + RAG eval script.
- F-CI-01 and F-CI-02 CI security scanning and controlled promotion workflow.
- F-DEP-02 container runtime non-root hardening.
- F-DEP-03 and F-MNT-01 documentation drift on architecture/security guidance.

Still open:
- F-SEC-02 privacy governance endpoints/retention policy enforcement.
- RAG evaluation remains non-blocking in CI (`continue-on-error: true`).
- Compliance hardening extensions (artifact attestations/signing and stricter deployment protection policy).

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
- Embedding implementation: `server/src/services/embeddings.ts` (semantic OpenAI embeddings in production; hash fallback for local/test)
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
- Pending stream requests are persisted in shared datastore (`pending_stream_requests`) with TTL-based expiry handling.

Tool/function calling layer:
- None found in backend services/routes.

File upload pipeline:
- No backend upload endpoint found.
- Frontend request helper supports `FormData` (`client/src/lib/api.ts:50`) but no server route consumes multipart data.

## Data flow narrative

1. User authenticates in SPA (`client/src/pages/AuthPage.tsx`) via cookie-based auth endpoints.
2. UI calls `POST /chat/stream/start` with message/module/session hints (`client/src/lib/api.ts`, `server/src/routes/chat.ts:72`).
3. API stores pending request in shared datastore keyed by `stream_id` (store-backed pending stream request methods).
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
Severity (baseline): High
Status (2026-03-01): Resolved
Baseline evidence:
- Pending stream requests were previously held in-process in a map, which did not survive restarts and was not replica-safe.
Current evidence:
- Pending stream request lifecycle is now handled through shared datastore methods in `server/src/store/types.ts`, `server/src/store/postgresStore.ts`, and `server/src/store/inMemoryStore.ts`.
- Chat routes use store-backed create/consume operations in `server/src/routes/chat.ts`.
Historical impact:
- Breaks under multi-instance scaling and on process restarts (stream IDs lost).
Resolution:
- Replaced route-level in-memory registry with shared datastore persistence and explicit expiry handling.

### F-REL-03 - Provider/vector resilience lacks retries/backoff/circuit-breakers
Severity (baseline): Medium
Status (2026-03-01): Resolved
Baseline evidence:
- Single-shot provider calls in `server/src/services/gemini.ts` without bounded retry/backoff and no provider circuit state.
- Single-shot vector query path in `server/src/services/vectorStore.ts` without retry/backoff/circuit policy.
Current evidence:
- Shared resilience layer added in `server/src/services/resilience.ts` with transient error classification, bounded exponential retry, jitter, and circuit-breaker primitives.
- LLM provider calls now run under retries + per-provider circuit breakers (`gemini`, `openai`) in `server/src/services/gemini.ts`.
- Chroma query/upsert paths now run under retries + per-dependency circuit breakers (`chroma.query`, `chroma.upsert`) in `server/src/services/vectorStore.ts`.
- Runtime tuning knobs are now exposed via env config in `server/src/config/env.ts` (`LLM_RETRY_*`, `VECTOR_RETRY_*`, `*_CIRCUIT_*`, `RETRY_JITTER_RATIO`).
Historical impact:
- Temporary upstream blips degraded UX and could increase error rates.
Resolution:
- Added bounded retries with jitter and per-dependency circuit-breaker counters for LLM and vector dependencies.

### F-REL-04 - Non-deterministic migration workflow for audited environments
Severity (baseline): High
Status (2026-03-01): Resolved
Baseline evidence:
- Runtime migration workflow previously relied on `drizzle-kit push`.
Current evidence:
- Migration flow now applies versioned SQL files via `server/scripts/migrate.ts`.
- Scripts updated in `server/package.json` (`migrate`, `migrate:status`) and SQL migrations tracked under `server/drizzle/*.sql`.
Historical impact:
- Reduced change traceability and rollback confidence.
Resolution:
- Switched to tracked versioned migration apply flow with `schema_migrations` state tracking.

## Observability

### F-OBS-01 - No metrics/tracing/SLO instrumentation
Severity (baseline): High
Status (2026-03-01): Resolved
Baseline evidence:
- Logging and health checks existed, but there was no tracing/metrics instrumentation around critical request/provider/retrieval paths.
Current evidence:
- Shared observability module now emits OpenTelemetry spans and metric instruments in `server/src/services/observability.ts`.
- Provider calls are instrumented with spans/metrics in `server/src/services/gemini.ts`.
- Vector retrieval/upsert paths are instrumented with spans/metrics in `server/src/services/vectorStore.ts`.
- Request latency/error metrics are captured in `server/src/middleware/logging.ts`.
- Stream lifecycle metrics (`started`, `completed`, `aborted`) and `stream_completion_rate` are recorded in chat flow (`server/src/routes/chat.ts`).
Historical impact:
- Hard to detect latency regressions, token cost spikes, and retrieval quality drift.
Resolution:
- Added OpenTelemetry spans and metrics (`latency`, `error_rate`, `token_usage`, `stream_completion_rate`) across request/provider/retrieval/stream paths.

### F-OBS-02 - Request logs lack conversation/session correlation ID
Severity (baseline): Medium
Status (2026-03-01): Resolved
Baseline evidence:
- Request logs included `requestId` and method/path/status, but no chat correlation fields.
Current evidence:
- Express request context now carries correlation IDs (`sessionId`, `streamId`) in `server/src/types/express.d.ts`.
- Chat routes set correlation IDs as sessions/streams are created/consumed in `server/src/routes/chat.ts`.
- Request logs now emit `sessionId` and `streamId` in `server/src/middleware/logging.ts`.
Historical impact:
- Slower incident triage for chat-specific issues.
Resolution:
- Added session/stream correlation enrichment so request logs include `sessionId` and `streamId` where available.

## Performance & Cost Control

### F-PERF-01 - No explicit output token caps in model requests
Severity (baseline): High
Status (2026-03-01): Resolved
Baseline evidence:
- OpenAI call previously lacked explicit max output token budget controls.
Current evidence:
- Runtime config now defines `LLM_MAX_OUTPUT_TOKENS` and normalized `llmMaxOutputTokens` in `server/src/config/env.ts`.
- Gemini request sets `generationConfig.maxOutputTokens` in `server/src/services/gemini.ts`.
- OpenAI request sets `max_tokens` in `server/src/services/gemini.ts`.
Historical impact:
- Cost variance and latency spikes under large prompts.
Resolution:
- Added configurable output caps (`LLM_MAX_OUTPUT_TOKENS`) with request-level enforcement across provider calls.

### F-PERF-02 - Configured RAG context limits are not enforced
Severity (baseline): Medium
Status (2026-03-01): Resolved
Baseline evidence:
- `ragMaxContextChars` config existed, but prompt assembly previously did not enforce a deterministic context-size budget.
Current evidence:
- `ragMaxContextChars` is parsed and normalized in `server/src/config/env.ts`.
- Context assembly now uses `toContextText(...)` with budget application in `server/src/services/gemini.ts`.
- Retrieval/prompt context trimming is enforced through `applyContextBudget(...)` in `server/src/services/vectorStore.ts`.
Historical impact:
- Larger prompt payloads, cost increases, and inconsistent quality.
Resolution:
- Enforced `ragMaxContextChars` during context assembly and truncation by retrieval order/score.

### F-PERF-03 - Embedding implementation is lexical hash vector, not semantic
Severity (baseline): Medium
Status (2026-03-01): Resolved
Baseline evidence:
- `server/src/services/embeddings.ts` previously generated lexical hash vectors only.
Current evidence:
- Embeddings now use semantic OpenAI embedding API with batching and caching in `server/src/services/embeddings.ts`.
- Vector-store upsert/query paths call async embedding methods (`embedTexts` / `embedText`) in `server/src/services/vectorStore.ts`.
Historical impact:
- Lower retrieval relevance/grounding versus production embedding models.
Resolution:
- Integrated semantic embedding provider with configurable model and batch size, and retained hash fallback for non-production safety.

### F-PERF-04 - DB indexing gaps for chat message retrieval paths
Severity (baseline): Medium
Status (2026-03-01): Resolved
Baseline evidence:
- `listMessages` query pattern (`sessionId` + `createdAt`) lacked explicit composite indexing guarantees in baseline schema.
Current evidence:
- Composite index for messages exists in schema (`messages_session_created_at_idx`) in `server/src/db/schema.ts`.
- Versioned migration `server/drizzle/0001_hot_path_indexes.sql` tracks hot-path index creation for messages, attempts, questions, and answers.
Historical impact:
- Query degradation risk at scale.
Resolution:
- Added and tracked composite indexes for chat/quiz hot paths (`messages(session_id, created_at)` and related attempt/answer indexes).

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
- PR5: implement governance/privacy controls (retention, user export/delete endpoints, audit trail events).
- Move `rag-eval` from non-blocking to policy-gated once baseline stability is proven.
- Operationalize observability baseline: OTEL exporters, dashboards, and SLO alerts over the new metrics/spans.

Next (3-8 weeks)
- Add retrieval-quality telemetry and cost/latency budgets for embedding + query paths.
- Tighten deployment compliance posture (attestations/signing, protected deployment policies, stricter branch protections).
- Tune circuit/retry thresholds using production latency/error telemetry and documented SLOs.

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
- Retrieval quality: integrated semantic OpenAI embeddings with batching/cache and configurable provider/model settings.
- Resilience policy: added bounded retry/backoff with jitter and circuit-breakers for LLM and vector dependencies.
- Resilience observability: added lightweight aggregated retry/circuit telemetry logs (`resilience_summary`, `resilience_circuit_opened`) to support threshold tuning.
- PR4 (CI/CD): TruffleHog + CodeQL + Trivy gates, staged approvals, smoke test, rollback automation.
- Stream request durability: moved pending stream request handling from in-process map to shared datastore persistence.
- Migration control: replaced runtime `drizzle-kit push` usage with versioned SQL migration runner (`server/scripts/migrate.ts`) backed by `schema_migrations`.
- Container hardening: API runtime switched to non-root user.
- Deployment validation: successful staging + production promotions (`run #31` and `run #32` on 2026-02-28 UTC, plus `run #41` on 2026-03-01 UTC).

Validation after changes:
- `npm run lint` passed
- `npm run test` passed
- `npm run build` passed
- `npm run eval:rag` passed
- `npm run audit` passed (1 low advisory remains: `qs`)
