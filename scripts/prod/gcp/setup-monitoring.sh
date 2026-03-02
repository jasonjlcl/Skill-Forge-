#!/usr/bin/env bash
set -euo pipefail

SERVICE_HOST="${1:?Usage: setup-monitoring.sh <service-host> <instance-name> <zone> [notification-channel-id,...]}"
INSTANCE_NAME="${2:?Usage: setup-monitoring.sh <service-host> <instance-name> <zone> [notification-channel-id,...]}"
ZONE="${3:?Usage: setup-monitoring.sh <service-host> <instance-name> <zone> [notification-channel-id,...]}"
NOTIFICATION_CHANNELS="${4:-}"

UPTIME_DISPLAY_NAME="${UPTIME_DISPLAY_NAME:-skillforge-api-health}"
UPTIME_PATH="${UPTIME_PATH:-/api/health}"
UPTIME_PERIOD_MINUTES="${UPTIME_PERIOD_MINUTES:-1}"
UPTIME_TIMEOUT_SECONDS="${UPTIME_TIMEOUT_SECONDS:-10}"

VM_CPU_ALERT_THRESHOLD="${VM_CPU_ALERT_THRESHOLD:-0.8}"
VM_CPU_ALERT_DURATION="${VM_CPU_ALERT_DURATION:-300s}"
VM_MEMORY_ALERT_THRESHOLD="${VM_MEMORY_ALERT_THRESHOLD:-90}"
VM_MEMORY_ALERT_DURATION="${VM_MEMORY_ALERT_DURATION:-600s}"

API_SLO_TARGET="${API_SLO_TARGET:-0.995}"
API_SLO_FAST_BURN_ERROR_RATIO="${API_SLO_FAST_BURN_ERROR_RATIO:-0.02}"
API_SLO_FAST_BURN_WINDOW="${API_SLO_FAST_BURN_WINDOW:-300s}"
API_SLO_SLOW_BURN_ERROR_RATIO="${API_SLO_SLOW_BURN_ERROR_RATIO:-0.005}"
API_SLO_SLOW_BURN_WINDOW="${API_SLO_SLOW_BURN_WINDOW:-3600s}"
API_SLO_LATENCY_P95_MS="${API_SLO_LATENCY_P95_MS:-1200}"
API_SLO_LATENCY_WINDOW="${API_SLO_LATENCY_WINDOW:-300s}"

REQUESTS_TOTAL_METRIC="${REQUESTS_TOTAL_METRIC:-skillforge_http_requests_total}"
REQUESTS_5XX_METRIC="${REQUESTS_5XX_METRIC:-skillforge_http_requests_5xx_total}"

PROJECT_ID="$(gcloud config get-value project)"
API_SLO_LATENCY_P95_SECONDS="$(awk "BEGIN { printf \"%.3f\", ${API_SLO_LATENCY_P95_MS} / 1000 }")"

echo "[monitoring] Ensuring Monitoring + Logging APIs are enabled..."
gcloud services enable monitoring.googleapis.com logging.googleapis.com --project "$PROJECT_ID" >/dev/null

echo "[monitoring] Resolving instance id for ${INSTANCE_NAME} (${ZONE})..."
INSTANCE_ID="$(gcloud compute instances describe "$INSTANCE_NAME" --zone "$ZONE" --format='value(id)')"
if [[ -z "$INSTANCE_ID" ]]; then
  echo "[monitoring] Could not resolve instance id." >&2
  exit 1
fi

echo "[monitoring] Ensuring uptime check ${UPTIME_DISPLAY_NAME} exists..."
UPTIME_NAME="$(gcloud monitoring uptime list-configs \
  --filter="displayName=${UPTIME_DISPLAY_NAME}" \
  --format='value(name)' \
  --project "$PROJECT_ID")"

if [[ -z "$UPTIME_NAME" ]]; then
  gcloud monitoring uptime create "$UPTIME_DISPLAY_NAME" \
    --project "$PROJECT_ID" \
    --resource-type=uptime-url \
    --resource-labels="host=${SERVICE_HOST},project_id=${PROJECT_ID}" \
    --protocol=https \
    --path="$UPTIME_PATH" \
    --period="$UPTIME_PERIOD_MINUTES" \
    --timeout="$UPTIME_TIMEOUT_SECONDS" \
    --regions=usa-oregon,usa-virginia,europe \
    --status-classes=2xx \
    --validate-ssl

  UPTIME_NAME="$(gcloud monitoring uptime list-configs \
    --filter="displayName=${UPTIME_DISPLAY_NAME}" \
    --format='value(name)' \
    --project "$PROJECT_ID")"
fi

UPTIME_CHECK_ID="${UPTIME_NAME##*/}"

upsert_log_metric() {
  local metric_name="$1"
  local description="$2"
  local log_filter="$3"

  if gcloud logging metrics describe "$metric_name" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud logging metrics update "$metric_name" \
      --project "$PROJECT_ID" \
      --description "$description" \
      --log-filter "$log_filter" >/dev/null
    echo "[monitoring] Updated logs-based metric: ${metric_name}"
  else
    gcloud logging metrics create "$metric_name" \
      --project "$PROJECT_ID" \
      --description "$description" \
      --log-filter "$log_filter" >/dev/null
    echo "[monitoring] Created logs-based metric: ${metric_name}"
  fi
}

create_policy_if_missing() {
  local display_name="$1"
  local policy_json="$2"

  local existing
  existing="$(gcloud monitoring policies list \
    --project "$PROJECT_ID" \
    --filter="displayName=${display_name}" \
    --format='value(name)')"

  if [[ -n "$existing" ]]; then
    echo "[monitoring] Policy already exists: ${display_name}"
    return
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  cat >"$tmp_file" <<<"$policy_json"

  if [[ -n "$NOTIFICATION_CHANNELS" ]]; then
    gcloud monitoring policies create \
      --project "$PROJECT_ID" \
      --policy-from-file="$tmp_file" \
      --notification-channels="$NOTIFICATION_CHANNELS" >/dev/null
  else
    gcloud monitoring policies create \
      --project "$PROJECT_ID" \
      --policy-from-file="$tmp_file" >/dev/null
  fi

  rm -f "$tmp_file"
  echo "[monitoring] Created policy: ${display_name}"
}

create_dashboard_if_missing() {
  local display_name="$1"
  local dashboard_json="$2"

  local existing
  existing="$(gcloud monitoring dashboards list \
    --project "$PROJECT_ID" \
    --filter="displayName=${display_name}" \
    --format='value(name)')"

  if [[ -n "$existing" ]]; then
    echo "[monitoring] Dashboard already exists: ${display_name}"
    return
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  cat >"$tmp_file" <<<"$dashboard_json"
  gcloud monitoring dashboards create \
    --project "$PROJECT_ID" \
    --config-from-file="$tmp_file" >/dev/null
  rm -f "$tmp_file"
  echo "[monitoring] Created dashboard: ${display_name}"
}

echo "[monitoring] Ensuring logs-based request metrics exist..."
upsert_log_metric \
  "$REQUESTS_TOTAL_METRIC" \
  "Total API request count from structured http_request logs." \
  'jsonPayload.message="http_request" AND jsonPayload.path=~"^/api/"'

upsert_log_metric \
  "$REQUESTS_5XX_METRIC" \
  "Total API 5xx request count from structured http_request logs." \
  'jsonPayload.message="http_request" AND jsonPayload.path=~"^/api/" AND jsonPayload.statusCode>=500'

create_policy_if_missing \
  "skillforge-uptime-check-failing" \
  "{
    \"displayName\": \"skillforge-uptime-check-failing\",
    \"combiner\": \"OR\",
    \"enabled\": true,
    \"conditions\": [
      {
        \"displayName\": \"Uptime check failed\",
        \"conditionThreshold\": {
          \"filter\": \"metric.type=\\\"monitoring.googleapis.com/uptime_check/check_passed\\\" AND resource.type=\\\"uptime_url\\\" AND metric.label.check_id=\\\"${UPTIME_CHECK_ID}\\\"\",
          \"comparison\": \"COMPARISON_LT\",
          \"thresholdValue\": 1,
          \"duration\": \"120s\",
          \"aggregations\": [
            {
              \"alignmentPeriod\": \"120s\",
              \"perSeriesAligner\": \"ALIGN_NEXT_OLDER\"
            }
          ],
          \"trigger\": { \"count\": 1 }
        }
      }
    ]
  }"

create_policy_if_missing \
  "skillforge-vm-cpu-high" \
  "{
    \"displayName\": \"skillforge-vm-cpu-high\",
    \"combiner\": \"OR\",
    \"enabled\": true,
    \"conditions\": [
      {
        \"displayName\": \"VM CPU > ${VM_CPU_ALERT_THRESHOLD} for ${VM_CPU_ALERT_DURATION}\",
        \"conditionThreshold\": {
          \"filter\": \"metric.type=\\\"compute.googleapis.com/instance/cpu/utilization\\\" AND resource.type=\\\"gce_instance\\\" AND resource.label.instance_id=\\\"${INSTANCE_ID}\\\"\",
          \"comparison\": \"COMPARISON_GT\",
          \"thresholdValue\": ${VM_CPU_ALERT_THRESHOLD},
          \"duration\": \"${VM_CPU_ALERT_DURATION}\",
          \"aggregations\": [
            {
              \"alignmentPeriod\": \"60s\",
              \"perSeriesAligner\": \"ALIGN_MEAN\"
            }
          ],
          \"trigger\": { \"count\": 1 }
        }
      }
    ]
  }"

create_policy_if_missing \
  "skillforge-vm-memory-high" \
  "{
    \"displayName\": \"skillforge-vm-memory-high\",
    \"combiner\": \"OR\",
    \"enabled\": true,
    \"conditions\": [
      {
        \"displayName\": \"VM memory > ${VM_MEMORY_ALERT_THRESHOLD}% for ${VM_MEMORY_ALERT_DURATION}\",
        \"conditionThreshold\": {
          \"filter\": \"metric.type=\\\"agent.googleapis.com/memory/percent_used\\\" AND resource.type=\\\"gce_instance\\\" AND resource.label.instance_id=\\\"${INSTANCE_ID}\\\"\",
          \"comparison\": \"COMPARISON_GT\",
          \"thresholdValue\": ${VM_MEMORY_ALERT_THRESHOLD},
          \"duration\": \"${VM_MEMORY_ALERT_DURATION}\",
          \"aggregations\": [
            {
              \"alignmentPeriod\": \"60s\",
              \"perSeriesAligner\": \"ALIGN_MEAN\"
            }
          ],
          \"trigger\": { \"count\": 1 }
        }
      }
    ]
  }"

create_policy_if_missing \
  "skillforge-api-slo-availability-fast-burn" \
  "{
    \"displayName\": \"skillforge-api-slo-availability-fast-burn\",
    \"combiner\": \"OR\",
    \"enabled\": true,
    \"documentation\": {
      \"content\": \"Approximate availability error-budget fast burn alert. Check 5xx surge, LB health, upstream provider failures, and rollback if needed.\",
      \"mimeType\": \"text/markdown\"
    },
    \"conditions\": [
      {
        \"displayName\": \"API 5xx ratio > ${API_SLO_FAST_BURN_ERROR_RATIO} over ${API_SLO_FAST_BURN_WINDOW}\",
        \"conditionThreshold\": {
          \"filter\": \"metric.type=\\\"logging.googleapis.com/user/${REQUESTS_5XX_METRIC}\\\"\",
          \"denominatorFilter\": \"metric.type=\\\"logging.googleapis.com/user/${REQUESTS_TOTAL_METRIC}\\\"\",
          \"comparison\": \"COMPARISON_GT\",
          \"thresholdValue\": ${API_SLO_FAST_BURN_ERROR_RATIO},
          \"duration\": \"${API_SLO_FAST_BURN_WINDOW}\",
          \"aggregations\": [
            {
              \"alignmentPeriod\": \"60s\",
              \"perSeriesAligner\": \"ALIGN_RATE\"
            }
          ],
          \"denominatorAggregations\": [
            {
              \"alignmentPeriod\": \"60s\",
              \"perSeriesAligner\": \"ALIGN_RATE\"
            }
          ],
          \"trigger\": { \"count\": 1 }
        }
      }
    ]
  }"

create_policy_if_missing \
  "skillforge-api-slo-availability-slow-burn" \
  "{
    \"displayName\": \"skillforge-api-slo-availability-slow-burn\",
    \"combiner\": \"OR\",
    \"enabled\": true,
    \"documentation\": {
      \"content\": \"Approximate availability error-budget slow burn alert. Investigate chronic degradation and tune retries/circuit thresholds.\",
      \"mimeType\": \"text/markdown\"
    },
    \"conditions\": [
      {
        \"displayName\": \"API 5xx ratio > ${API_SLO_SLOW_BURN_ERROR_RATIO} over ${API_SLO_SLOW_BURN_WINDOW}\",
        \"conditionThreshold\": {
          \"filter\": \"metric.type=\\\"logging.googleapis.com/user/${REQUESTS_5XX_METRIC}\\\"\",
          \"denominatorFilter\": \"metric.type=\\\"logging.googleapis.com/user/${REQUESTS_TOTAL_METRIC}\\\"\",
          \"comparison\": \"COMPARISON_GT\",
          \"thresholdValue\": ${API_SLO_SLOW_BURN_ERROR_RATIO},
          \"duration\": \"${API_SLO_SLOW_BURN_WINDOW}\",
          \"aggregations\": [
            {
              \"alignmentPeriod\": \"300s\",
              \"perSeriesAligner\": \"ALIGN_RATE\"
            }
          ],
          \"denominatorAggregations\": [
            {
              \"alignmentPeriod\": \"300s\",
              \"perSeriesAligner\": \"ALIGN_RATE\"
            }
          ],
          \"trigger\": { \"count\": 1 }
        }
      }
    ]
  }"

create_policy_if_missing \
  "skillforge-api-slo-latency-p95-high" \
  "{
    \"displayName\": \"skillforge-api-slo-latency-p95-high\",
    \"combiner\": \"OR\",
    \"enabled\": true,
    \"documentation\": {
      \"content\": \"p95 uptime-check latency SLO breach. Check API saturation, DB/vector latency, and upstream LLM provider latency.\",
      \"mimeType\": \"text/markdown\"
    },
    \"conditions\": [
      {
        \"displayName\": \"Uptime p95 latency > ${API_SLO_LATENCY_P95_MS}ms over ${API_SLO_LATENCY_WINDOW}\",
        \"conditionThreshold\": {
          \"filter\": \"metric.type=\\\"monitoring.googleapis.com/uptime_check/request_latency\\\" AND resource.type=\\\"uptime_url\\\" AND metric.label.check_id=\\\"${UPTIME_CHECK_ID}\\\"\",
          \"comparison\": \"COMPARISON_GT\",
          \"thresholdValue\": ${API_SLO_LATENCY_P95_SECONDS},
          \"duration\": \"${API_SLO_LATENCY_WINDOW}\",
          \"aggregations\": [
            {
              \"alignmentPeriod\": \"60s\",
              \"perSeriesAligner\": \"ALIGN_PERCENTILE_95\"
            }
          ],
          \"trigger\": { \"count\": 1 }
        }
      }
    ]
  }"

create_dashboard_if_missing \
  "skillforge-api-overview" \
  "{
    \"displayName\": \"skillforge-api-overview\",
    \"gridLayout\": {
      \"columns\": \"2\",
      \"widgets\": [
        {
          \"title\": \"Uptime Check Pass Ratio\",
          \"xyChart\": {
            \"dataSets\": [
              {
                \"plotType\": \"LINE\",
                \"targetAxis\": \"Y1\",
                \"timeSeriesQuery\": {
                  \"timeSeriesFilter\": {
                    \"filter\": \"metric.type=\\\"monitoring.googleapis.com/uptime_check/check_passed\\\" AND resource.type=\\\"uptime_url\\\" AND metric.label.check_id=\\\"${UPTIME_CHECK_ID}\\\"\",
                    \"aggregation\": {
                      \"alignmentPeriod\": \"60s\",
                      \"perSeriesAligner\": \"ALIGN_MEAN\"
                    }
                  }
                }
              }
            ],
            \"yAxis\": {
              \"label\": \"ratio\",
              \"scale\": \"LINEAR\"
            }
          }
        },
        {
          \"title\": \"Uptime p95 Latency (s)\",
          \"xyChart\": {
            \"dataSets\": [
              {
                \"plotType\": \"LINE\",
                \"targetAxis\": \"Y1\",
                \"timeSeriesQuery\": {
                  \"timeSeriesFilter\": {
                    \"filter\": \"metric.type=\\\"monitoring.googleapis.com/uptime_check/request_latency\\\" AND resource.type=\\\"uptime_url\\\" AND metric.label.check_id=\\\"${UPTIME_CHECK_ID}\\\"\",
                    \"aggregation\": {
                      \"alignmentPeriod\": \"60s\",
                      \"perSeriesAligner\": \"ALIGN_PERCENTILE_95\"
                    }
                  }
                }
              }
            ],
            \"yAxis\": {
              \"label\": \"seconds\",
              \"scale\": \"LINEAR\"
            }
          }
        },
        {
          \"title\": \"API Request Rate (/s)\",
          \"xyChart\": {
            \"dataSets\": [
              {
                \"plotType\": \"LINE\",
                \"targetAxis\": \"Y1\",
                \"timeSeriesQuery\": {
                  \"timeSeriesFilter\": {
                    \"filter\": \"metric.type=\\\"logging.googleapis.com/user/${REQUESTS_TOTAL_METRIC}\\\"\",
                    \"aggregation\": {
                      \"alignmentPeriod\": \"60s\",
                      \"perSeriesAligner\": \"ALIGN_RATE\"
                    }
                  }
                }
              }
            ],
            \"yAxis\": {
              \"label\": \"requests/s\",
              \"scale\": \"LINEAR\"
            }
          }
        },
        {
          \"title\": \"API 5xx Rate (/s)\",
          \"xyChart\": {
            \"dataSets\": [
              {
                \"plotType\": \"LINE\",
                \"targetAxis\": \"Y1\",
                \"timeSeriesQuery\": {
                  \"timeSeriesFilter\": {
                    \"filter\": \"metric.type=\\\"logging.googleapis.com/user/${REQUESTS_5XX_METRIC}\\\"\",
                    \"aggregation\": {
                      \"alignmentPeriod\": \"60s\",
                      \"perSeriesAligner\": \"ALIGN_RATE\"
                    }
                  }
                }
              }
            ],
            \"yAxis\": {
              \"label\": \"errors/s\",
              \"scale\": \"LINEAR\"
            }
          }
        }
      ]
    }
  }"

echo "[monitoring] Completed. Uptime check id: ${UPTIME_CHECK_ID}"
echo "[monitoring] Logs-based metrics: ${REQUESTS_TOTAL_METRIC}, ${REQUESTS_5XX_METRIC}"
echo "[monitoring] SLO target (availability): ${API_SLO_TARGET}"
echo "[monitoring] Fast burn ratio threshold: ${API_SLO_FAST_BURN_ERROR_RATIO} over ${API_SLO_FAST_BURN_WINDOW}"
echo "[monitoring] Slow burn ratio threshold: ${API_SLO_SLOW_BURN_ERROR_RATIO} over ${API_SLO_SLOW_BURN_WINDOW}"
echo "[monitoring] p95 latency threshold: ${API_SLO_LATENCY_P95_MS}ms over ${API_SLO_LATENCY_WINDOW}"
