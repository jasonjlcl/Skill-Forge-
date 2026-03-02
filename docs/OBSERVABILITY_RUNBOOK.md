# Observability Runbook

## Scope

This runbook operationalizes traces, metrics, dashboards, and SLO-driven alerts for production.

## Exporter Strategy

The API supports explicit OpenTelemetry exporter modes via environment variables:

- `OTEL_EXPORTER_MODE=none`: disable exporters (default, safe fallback).
- `OTEL_EXPORTER_MODE=console`: emit spans/metrics to stdout for short debugging sessions.
- `OTEL_EXPORTER_MODE=otlp`: export traces/metrics over OTLP HTTP.

Core variables:

- `OTEL_SERVICE_NAME`, `OTEL_SERVICE_VERSION`
- `OTEL_EXPORTER_OTLP_ENDPOINT` (base endpoint; `/v1/traces` and `/v1/metrics` are inferred)
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` (optional signal-specific override)
- `OTEL_EXPORTER_OTLP_HEADERS` (comma-separated `key=value` list)
- `OTEL_METRIC_EXPORT_INTERVAL_MS`, `OTEL_METRIC_EXPORT_TIMEOUT_MS`

## Production Setup (GCP)

1. Install Ops Agent on VM:

```bash
bash scripts/prod/gcp/install-ops-agent.sh <instance-name> <zone>
```

2. Configure uptime checks, logs-based request metrics, SLO alerts, and dashboard:

```bash
bash scripts/prod/gcp/setup-monitoring.sh <service-host> <instance-name> <zone> [notification-channel-id,...]
```

## SLO Policy Knobs

`setup-monitoring.sh` supports tuning via environment variables:

- `API_SLO_TARGET`
- `API_SLO_FAST_BURN_ERROR_RATIO`, `API_SLO_FAST_BURN_WINDOW`
- `API_SLO_SLOW_BURN_ERROR_RATIO`, `API_SLO_SLOW_BURN_WINDOW`
- `API_SLO_LATENCY_P95_MS`, `API_SLO_LATENCY_WINDOW`
- `VM_CPU_ALERT_THRESHOLD`, `VM_CPU_ALERT_DURATION`
- `VM_MEMORY_ALERT_THRESHOLD`, `VM_MEMORY_ALERT_DURATION`

Suggested first pass:

- Keep defaults for two weeks.
- Review daily `observability_summary` and incident alerts.
- Tighten thresholds only after establishing a stable traffic baseline.

## On-Call Triage

When `skillforge-api-slo-availability-*` or `skillforge-api-slo-latency-p95-high` fires:

1. Check `skillforge-api-overview` dashboard for request and 5xx rate shape.
2. Check uptime pass ratio and uptime latency trend.
3. Inspect API logs around `http_request`, `request_failed`, `resilience_summary`, and `resilience_circuit_opened`.
4. If user-facing impact is sustained, execute rollback playbook:
   - `docs/ROLLBACK_PLAYBOOK.md`
