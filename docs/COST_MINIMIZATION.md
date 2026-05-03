# Cost Minimization Runbook

Use this profile when the priority is the lowest predictable cloud bill, with quality and high-availability tradeoffs accepted.

## Lowest-Cost Runtime Profile

Start from `.env.production.example`; it now defaults to the low-cost profile.

Key settings:

- `LLM_PROVIDER=gemini` prevents accidental OpenAI fallback spend.
- `GEMINI_MODEL=gemini-2.0-flash-lite` targets the low-cost Gemini text tier.
- `EMBEDDING_PROVIDER=hash` disables paid embedding API calls for both ingestion and retrieval queries.
- `RAG_TOP_K=2`, `RAG_MAX_TOP_K=4`, and `RAG_MAX_CONTEXT_CHARS=1800` cap prompt input tokens.
- `RAG_REQUIRE_CONTEXT=true` skips paid LLM calls when retrieval finds no relevant context.
- `LLM_MAX_OUTPUT_TOKENS=320` caps generated output.
- `LLM_RETRY_MAX_ATTEMPTS=1` and `VECTOR_RETRY_MAX_ATTEMPTS=1` avoid duplicate paid calls during upstream incidents.
- `LOG_HTTP_REQUESTS=false`, `OBSERVABILITY_SUMMARY_LOGS=false`, and `OTEL_EXPORTER_MODE=none` reduce Cloud Logging and telemetry volume.
- `DATA_RETENTION_DAYS=30` limits database growth.
- `DATABASE_POOL_MAX=5` keeps database connection usage modest for small instances.

To disable all paid LLM calls, set `LLM_PROVIDER=local`. The app will use deterministic fallback training answers and quizzes.

## Hosting Profile

Minimum fixed cost is a single small VM running Docker Compose:

```bash
npm run docker:prod:up
```

Avoid the GCP load balancer and Cloud Armor helper unless the app needs managed edge security or global load balancing:

```bash
# Skip this for minimum cost:
bash scripts/prod/gcp/setup-https-lb-cloud-armor.sh ...
```

Use the direct Nginx/Certbot path instead when a single VM with public ports is acceptable:

```bash
npm run docker:prod:up:tls
```

Cloud Scheduler is cheap, but not required for the retention job. For the lowest fixed footprint, run retention from the VM cron instead of provisioning Cloud Scheduler:

```bash
curl -fsS -X POST http://localhost/api/internal/retention/run \
  -H "Authorization: Bearer $RETENTION_JOB_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"days":30}'
```

## Provider Pricing References

Prices change. Re-check before changing model or infrastructure choices:

- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- OpenAI API pricing: https://developers.openai.com/api/docs/pricing
- Google Cloud Load Balancing pricing: https://cloud.google.com/load-balancing/pricing
- Google Cloud Armor pricing: https://cloud.google.com/armor/pricing
- Google Cloud Scheduler pricing: https://cloud.google.com/scheduler/pricing
- Google Cloud Logging pricing: https://cloud.google.com/logging
- Google Cloud Compute Engine free tier: https://cloud.google.com/free/docs/compute-getting-started

## Tradeoffs

This profile reduces cost by lowering retrieval breadth, prompt size, output length, retries, and log volume. Retrieval quality will be weaker with hash embeddings than semantic OpenAI embeddings. Production incident visibility is also lower when request logs and summary logs are disabled.
