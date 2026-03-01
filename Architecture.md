# System Architecture

This document is Markdown (`.md`) so GitHub can render Mermaid diagrams directly.

## Overview

Skill Forge is a React SPA + Express backend platform for onboarding chat, quizzes, and progress analytics.

```mermaid
flowchart LR
  User --> Browser
  Browser --> WEB["NGINX Web Edge"]
  WEB --> SPA["React SPA (Vite)"]
  WEB -->|/api| API["Express API"]
  WEB -->|/api/chat/stream| SSE["SSE endpoint"]

  API --> DB[("PostgreSQL via Drizzle")]
  API --> VS[("ChromaDB / InMemory Vector Store")]
  API --> LLM["Gemini 1.5 Flash / OpenAI gpt-4o-mini"]
```

## Chat Safety and Retrieval Flow

```mermaid
sequenceDiagram
  participant SPA as React SPA
  participant API as Express API
  participant VS as Vector Store
  participant SAFE as Safety Layer
  participant LLM as LLM

  SPA->>API: POST /api/chat/stream/start
  API-->>SPA: streamId
  SPA->>API: GET /api/chat/stream?stream_id=...
  API->>VS: query(topK, minScore, module)
  VS-->>API: retrieved chunks
  API->>SAFE: sanitize retrieved context
  SAFE-->>API: trust/risk-tagged context
  API->>LLM: prompt(question + sanitized context)
  LLM-->>API: answer draft
  API->>SAFE: moderate output
  SAFE-->>API: allow/reframe/block + safe answer
  API-->>SPA: SSE meta/token/done
```

## Runtime Components

- Frontend: `client/src` React SPA, auth/chat/quiz/analytics UI.
- Backend: `server/src` routes, middleware, app wiring.
- Data: PostgreSQL for transactional data, ChromaDB (or in-memory fallback) for retrieval.
  - Pending stream requests are persisted with TTL/expiry semantics for restart and replica safety.
- AI:
  - `services/gemini.ts` provider orchestration (Gemini -> OpenAI -> deterministic fallback).
  - `services/vectorStore.ts` retrieval and context budgeting.
  - `services/embeddings.ts` semantic embedding provider (OpenAI) with non-prod hash fallback.
  - `services/safety.ts` context sanitization and output moderation.

## Guardrails

- Reliability:
  - Async handler wrapper forwards async exceptions to centralized JSON 5xx handling.
- Cost:
  - `RAG_MAX_CONTEXT_CHARS`
  - `LLM_MAX_OUTPUT_TOKENS`
  - `LLM_TIMEOUT_MS`
- Safety:
  - Retrieved context injection sanitization + risk tagging.
  - Output moderation policy with allow/reframe/block decisions.

## Current API Shape (Chat)

- `POST /api/chat/stream/start`
- `GET /api/chat/stream?stream_id=...`
- SSE `meta` includes context source metadata plus trust/risk tags.
- SSE `done` includes moderated answer + moderation decision metadata.

## Database Hot-Path Indexes

- `messages(session_id, created_at)`
- `sessions(user_id, last_active_at)`
- `quiz_attempts(user_id, started_at)`
- `quiz_questions(attempt_id, position)`
- `quiz_answers(attempt_id, answered_at)`
- `pending_stream_requests(user_id, expires_at)`
- `pending_stream_requests(expires_at)`

Versioned migration:
- `server/drizzle/0001_hot_path_indexes.sql`
- `server/drizzle/0002_pending_stream_requests.sql`

Migration apply flow:
- Versioned SQL migrations are applied by `server/scripts/migrate.ts`.
- Applied migration state is tracked in `schema_migrations`.
