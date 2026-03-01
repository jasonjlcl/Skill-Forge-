#!/usr/bin/env bash
set -euo pipefail

SERVICE_HOST="${1:?Usage: setup-monitoring.sh <service-host> <instance-name> <zone> [notification-channel-id,...]}"
INSTANCE_NAME="${2:?Usage: setup-monitoring.sh <service-host> <instance-name> <zone> [notification-channel-id,...]}"
ZONE="${3:?Usage: setup-monitoring.sh <service-host> <instance-name> <zone> [notification-channel-id,...]}"
NOTIFICATION_CHANNELS="${4:-}"

PROJECT_ID="$(gcloud config get-value project)"
UPTIME_DISPLAY_NAME="skillforge-api-health"
UPTIME_PATH="/api/health"

echo "[monitoring] Ensuring Monitoring API is enabled..."
gcloud services enable monitoring.googleapis.com --project "$PROJECT_ID" >/dev/null

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
    --period=1 \
    --timeout=10 \
    --regions=usa-oregon,usa-virginia,europe \
    --status-classes=2xx \
    --validate-ssl

  UPTIME_NAME="$(gcloud monitoring uptime list-configs \
    --filter="displayName=${UPTIME_DISPLAY_NAME}" \
    --format='value(name)' \
    --project "$PROJECT_ID")"
fi

UPTIME_CHECK_ID="${UPTIME_NAME##*/}"

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
        \"displayName\": \"VM CPU > 80% for 5m\",
        \"conditionThreshold\": {
          \"filter\": \"metric.type=\\\"compute.googleapis.com/instance/cpu/utilization\\\" AND resource.type=\\\"gce_instance\\\" AND resource.label.instance_id=\\\"${INSTANCE_ID}\\\"\",
          \"comparison\": \"COMPARISON_GT\",
          \"thresholdValue\": 0.8,
          \"duration\": \"300s\",
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
        \"displayName\": \"VM memory > 90% for 10m\",
        \"conditionThreshold\": {
          \"filter\": \"metric.type=\\\"agent.googleapis.com/memory/percent_used\\\" AND resource.type=\\\"gce_instance\\\" AND resource.label.instance_id=\\\"${INSTANCE_ID}\\\"\",
          \"comparison\": \"COMPARISON_GT\",
          \"thresholdValue\": 90,
          \"duration\": \"600s\",
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

echo "[monitoring] Completed. Uptime check id: ${UPTIME_CHECK_ID}"
