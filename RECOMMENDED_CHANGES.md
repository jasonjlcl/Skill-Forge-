# Recommended Changes - PR Plan

## PR1 - Reliability + Cost Guardrails (Immediate)

Scope:
- Add async error wrapper for all async Express handlers.
- Enforce LLM output caps and prompt context budget.
- Add DB indexes for chat/quiz hot query paths.

Files to change:
- `server/src/app.ts`
- `server/src/routes/*.ts`
- `server/src/services/gemini.ts`
- `server/src/services/vectorStore.ts` (context budgeting integration)
- `server/src/db/schema.ts`
- `server/drizzle/*` (versioned migration for indexes)
- `.env.example`, `.env.production.example`

Acceptance criteria:
- Any thrown async handler error returns 5xx JSON and does not crash process.
- `LLM_MAX_OUTPUT_TOKENS` and `RAG_MAX_CONTEXT_CHARS` actively constrain provider payloads.
- Message retrieval query uses index-backed plan.
- Existing test suite passes; add 2 tests for async error path + context trimming.

Effort: M

## PR2 - AI Safety + RAG Quality Baseline

Scope:
- Add output moderation/safety check layer.
- Add prompt-injection resilience policy for retrieved context.
- Restore and wire `scripts/eval-rag.ts` with baseline checks.

Files to change:
- `server/src/services/gemini.ts`
- `server/src/routes/chat.ts`
- `server/src/services/*` (new moderation/safety module)
- `scripts/eval-rag.ts` (new)
- `package.json` (ensure script validity)
- `README.md` (document quality gates)

Acceptance criteria:
- Unsafe output classes are blocked/reframed by policy.
- Retrieved context is tagged/sanitized before prompt assembly.
- `npm run eval:rag` executes and produces pass/fail summary.
- Add CI job to run eval in non-blocking mode initially.

Effort: M

## PR3 - Observability + Operational Readiness

Scope:
- Add metrics and tracing skeleton (request, retrieval, model call, stream lifecycle).
- Add alert-ready KPIs and structured log enrichment (`sessionId`, `streamId`).
- Add health/readiness split if needed (`/healthz`, `/readyz`).

Files to change:
- `server/src/middleware/logging.ts`
- `server/src/routes/chat.ts`
- `server/src/services/health.ts`
- `server/src/index.ts`
- infra/deployment docs

Acceptance criteria:
- Dashboard-ready metrics exported for p50/p95 latency, error rate, stream completion rate.
- Trace spans correlate API -> retrieval -> LLM call.
- Alerts defined for sustained 5xx, stream failure spike, dependency degradation.

Effort: M

## PR4 - CI/CD Security + Controlled Promotion

Scope:
- Add secret scanning, SAST, and container vulnerability scan to CI.
- Add staged deployment jobs with environment approvals and post-deploy smoke tests.
- Add rollback playbook and automated smoke rollback trigger.

Files to change:
- `.github/workflows/ci-cd.yml`
- deployment scripts (`scripts/prod/*`)
- release docs

Acceptance criteria:
- PR checks fail on verified secret leaks/high-severity image vulns.
- Staging deploy is one-click with required approvals.
- Production deploy runs smoke suite and emits clear pass/fail status.

Effort: M

## PR5 - Governance + Privacy Controls

Scope:
- Add data retention policy enforcement for messages/sessions.
- Add user data export/delete endpoints and admin audit event model.
- Align docs and runbooks.

Files to change:
- `server/src/routes/*` (new endpoints)
- `server/src/store/*`
- `server/src/db/schema.ts` + migrations
- `README.md` + operations docs

Acceptance criteria:
- Time-bound retention job exists and is test-covered.
- Export/delete endpoints documented and validated.
- Audit trail captures sensitive admin actions.

Effort: L

## Suggested order

1. PR1
2. PR2
3. PR4
4. PR3
5. PR5
