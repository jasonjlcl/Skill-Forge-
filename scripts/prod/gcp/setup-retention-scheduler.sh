#!/usr/bin/env bash
set -euo pipefail

JOB_NAME="${1:?Usage: setup-retention-scheduler.sh <job-name> <service-url> [location] [schedule] [time-zone] [retention-days] [service-account-email]}"
SERVICE_URL="${2:?Usage: setup-retention-scheduler.sh <job-name> <service-url> [location] [schedule] [time-zone] [retention-days] [service-account-email]}"
LOCATION="${3:-asia-southeast1}"
SCHEDULE="${4:-15 3 * * *}"
TIME_ZONE="${5:-Etc/UTC}"
RETENTION_DAYS="${6:-180}"
SERVICE_ACCOUNT_EMAIL="${7:-}"
RETENTION_JOB_EDGE_HEADER_NAME="${RETENTION_JOB_EDGE_HEADER_NAME:-X-Skillforge-Internal-Job}"
RETENTION_JOB_EDGE_HEADER_VALUE="${RETENTION_JOB_EDGE_HEADER_VALUE:-retention}"
RETENTION_JOB_EDGE_SHARED_KEY_HEADER_NAME="${RETENTION_JOB_EDGE_SHARED_KEY_HEADER_NAME:-X-Skillforge-Edge-Key}"
RETENTION_JOB_EDGE_SHARED_KEY="${RETENTION_JOB_EDGE_SHARED_KEY:-}"

PROJECT_ID="$(gcloud config get-value project)"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

if [[ -z "$SERVICE_ACCOUNT_EMAIL" ]]; then
  SERVICE_ACCOUNT_EMAIL="skillforge-retention-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
fi

SCHEDULER_AGENT="service-${PROJECT_NUMBER}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_EMAIL%@*}"
SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_NAME##*/}"

echo "[scheduler] Enabling required APIs..."
gcloud services enable cloudscheduler.googleapis.com iamcredentials.googleapis.com --project "$PROJECT_ID" >/dev/null

echo "[scheduler] Ensuring service account ${SERVICE_ACCOUNT_EMAIL} exists..."
if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
    --project "$PROJECT_ID" \
    --display-name="Skill Forge Retention Scheduler"
fi

echo "[scheduler] Granting token creator to Cloud Scheduler service agent..."
gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT_EMAIL" \
  --project "$PROJECT_ID" \
  --member="serviceAccount:${SCHEDULER_AGENT}" \
  --role="roles/iam.serviceAccountTokenCreator" >/dev/null

JOB_PAYLOAD="{\"days\":${RETENTION_DAYS}}"
REQUEST_HEADERS="Content-Type=application/json,${RETENTION_JOB_EDGE_HEADER_NAME}=${RETENTION_JOB_EDGE_HEADER_VALUE}"
if [[ -n "$RETENTION_JOB_EDGE_SHARED_KEY" ]]; then
  REQUEST_HEADERS="${REQUEST_HEADERS},${RETENTION_JOB_EDGE_SHARED_KEY_HEADER_NAME}=${RETENTION_JOB_EDGE_SHARED_KEY}"
fi

if gcloud scheduler jobs describe "$JOB_NAME" --location "$LOCATION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "[scheduler] Updating existing job ${JOB_NAME}..."
  gcloud scheduler jobs update http "$JOB_NAME" \
    --project "$PROJECT_ID" \
    --location "$LOCATION" \
    --schedule "$SCHEDULE" \
    --time-zone "$TIME_ZONE" \
    --uri "$SERVICE_URL" \
    --http-method POST \
    --headers "$REQUEST_HEADERS" \
    --message-body "$JOB_PAYLOAD" \
    --oidc-service-account-email "$SERVICE_ACCOUNT_EMAIL" \
    --oidc-token-audience "$SERVICE_URL"
else
  echo "[scheduler] Creating job ${JOB_NAME}..."
  gcloud scheduler jobs create http "$JOB_NAME" \
    --project "$PROJECT_ID" \
    --location "$LOCATION" \
    --schedule "$SCHEDULE" \
    --time-zone "$TIME_ZONE" \
    --uri "$SERVICE_URL" \
    --http-method POST \
    --headers "$REQUEST_HEADERS" \
    --message-body "$JOB_PAYLOAD" \
    --oidc-service-account-email "$SERVICE_ACCOUNT_EMAIL" \
    --oidc-token-audience "$SERVICE_URL"
fi

echo "[scheduler] Completed."
echo "[scheduler] Service account: ${SERVICE_ACCOUNT_EMAIL}"
echo "[scheduler] URL / audience: ${SERVICE_URL}"
echo "[scheduler] Edge marker header: ${RETENTION_JOB_EDGE_HEADER_NAME}=${RETENTION_JOB_EDGE_HEADER_VALUE}"
if [[ -n "$RETENTION_JOB_EDGE_SHARED_KEY" ]]; then
  echo "[scheduler] Edge shared-key header enabled: ${RETENTION_JOB_EDGE_SHARED_KEY_HEADER_NAME}"
fi
