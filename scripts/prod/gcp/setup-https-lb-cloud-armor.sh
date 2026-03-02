#!/usr/bin/env bash
set -euo pipefail

INSTANCE_NAME="${1:?Usage: setup-https-lb-cloud-armor.sh <instance-name> <zone> <domain> [prefix] [target-tag]}"
ZONE="${2:?Usage: setup-https-lb-cloud-armor.sh <instance-name> <zone> <domain> [prefix] [target-tag]}"
DOMAIN_NAME="${3:?Usage: setup-https-lb-cloud-armor.sh <instance-name> <zone> <domain> [prefix] [target-tag]}"
PREFIX="${4:-skillforge-prod}"
TARGET_TAG="${5:-skillforge-web}"

RETENTION_ALLOW_PRIORITY="${RETENTION_ALLOW_PRIORITY:-850}"
RETENTION_DENY_PRIORITY="${RETENTION_DENY_PRIORITY:-851}"
RETENTION_JOB_ALLOWED_SOURCE_RANGES="${RETENTION_JOB_ALLOWED_SOURCE_RANGES:-}"
RETENTION_JOB_EDGE_HEADER_NAME="${RETENTION_JOB_EDGE_HEADER_NAME:-X-Skillforge-Internal-Job}"
RETENTION_JOB_EDGE_HEADER_VALUE="${RETENTION_JOB_EDGE_HEADER_VALUE:-retention}"
RETENTION_JOB_EDGE_SHARED_KEY_HEADER_NAME="${RETENTION_JOB_EDGE_SHARED_KEY_HEADER_NAME:-X-Skillforge-Edge-Key}"
RETENTION_JOB_EDGE_SHARED_KEY="${RETENTION_JOB_EDGE_SHARED_KEY:-}"
WAF_MODE="${WAF_MODE:-enforce}"
BACKEND_TIMEOUT="${BACKEND_TIMEOUT:-300s}"

PROJECT_ID="$(gcloud config get-value project)"
NETWORK_NAME="default"

INSTANCE_GROUP="${PREFIX}-ig"
HEALTH_CHECK="${PREFIX}-hc"
BACKEND_SERVICE="${PREFIX}-backend"
SECURITY_POLICY="${PREFIX}-armor"
URL_MAP="${PREFIX}-url-map"
HTTPS_PROXY="${PREFIX}-https-proxy"
SSL_CERT="${PREFIX}-cert"
GLOBAL_IP="${PREFIX}-ip"
FORWARDING_RULE="${PREFIX}-https-fr"
FIREWALL_RULE="${PREFIX}-allow-hc"

if [[ "$RETENTION_JOB_EDGE_HEADER_NAME" == *"'"* || "$RETENTION_JOB_EDGE_HEADER_VALUE" == *"'"* ]]; then
  echo "[lb] RETENTION_JOB_EDGE_HEADER_NAME/RETENTION_JOB_EDGE_HEADER_VALUE cannot contain single quotes."
  exit 1
fi

if [[ "$RETENTION_JOB_EDGE_SHARED_KEY_HEADER_NAME" == *"'"* || "$RETENTION_JOB_EDGE_SHARED_KEY" == *"'"* ]]; then
  echo "[lb] RETENTION_JOB_EDGE_SHARED_KEY_HEADER_NAME/RETENTION_JOB_EDGE_SHARED_KEY cannot contain single quotes."
  exit 1
fi

WAF_MODE="${WAF_MODE,,}"
case "$WAF_MODE" in
  enforce)
    WAF_PREVIEW="false"
    ;;
  preview)
    WAF_PREVIEW="true"
    ;;
  *)
    echo "[lb] WAF_MODE must be either 'enforce' or 'preview'."
    exit 1
    ;;
esac

echo "[lb] Enabling required APIs..."
gcloud services enable compute.googleapis.com certificatemanager.googleapis.com --project "$PROJECT_ID" >/dev/null

echo "[lb] Ensuring health-check firewall rule exists..."
if ! gcloud compute firewall-rules describe "$FIREWALL_RULE" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "$FIREWALL_RULE" \
    --project "$PROJECT_ID" \
    --network "$NETWORK_NAME" \
    --direction INGRESS \
    --priority 1000 \
    --action ALLOW \
    --rules tcp:80 \
    --source-ranges 35.191.0.0/16,130.211.0.0/22 \
    --target-tags "$TARGET_TAG" >/dev/null
fi

echo "[lb] Ensuring unmanaged instance group exists..."
if ! gcloud compute instance-groups unmanaged describe "$INSTANCE_GROUP" \
  --project "$PROJECT_ID" \
  --zone "$ZONE" >/dev/null 2>&1; then
  gcloud compute instance-groups unmanaged create "$INSTANCE_GROUP" \
    --project "$PROJECT_ID" \
    --zone "$ZONE" >/dev/null
fi

echo "[lb] Ensuring instance membership and named port..."
if ! gcloud compute instance-groups unmanaged list-instances "$INSTANCE_GROUP" \
  --project "$PROJECT_ID" \
  --zone "$ZONE" \
  --format='value(instance.basename())' | grep -q "^${INSTANCE_NAME}$"; then
  gcloud compute instance-groups unmanaged add-instances "$INSTANCE_GROUP" \
    --project "$PROJECT_ID" \
    --zone "$ZONE" \
    --instances "$INSTANCE_NAME" >/dev/null
fi

gcloud compute instance-groups unmanaged set-named-ports "$INSTANCE_GROUP" \
  --project "$PROJECT_ID" \
  --zone "$ZONE" \
  --named-ports http:80 >/dev/null

echo "[lb] Ensuring health check and backend service..."
if ! gcloud compute health-checks describe "$HEALTH_CHECK" --project "$PROJECT_ID" --global >/dev/null 2>&1; then
  gcloud compute health-checks create http "$HEALTH_CHECK" \
    --project "$PROJECT_ID" \
    --global \
    --request-path /api/health \
    --port 80 >/dev/null
fi

if ! gcloud compute backend-services describe "$BACKEND_SERVICE" --project "$PROJECT_ID" --global >/dev/null 2>&1; then
  gcloud compute backend-services create "$BACKEND_SERVICE" \
    --project "$PROJECT_ID" \
    --global \
    --protocol HTTP \
    --health-checks "$HEALTH_CHECK" \
    --timeout "$BACKEND_TIMEOUT" >/dev/null
fi

if ! gcloud compute backend-services get-health "$BACKEND_SERVICE" \
  --project "$PROJECT_ID" \
  --global \
  --group "https://www.googleapis.com/compute/v1/projects/${PROJECT_ID}/zones/${ZONE}/instanceGroups/${INSTANCE_GROUP}" >/dev/null 2>&1; then
  gcloud compute backend-services add-backend "$BACKEND_SERVICE" \
    --project "$PROJECT_ID" \
    --global \
    --instance-group "$INSTANCE_GROUP" \
    --instance-group-zone "$ZONE" >/dev/null
fi

gcloud compute backend-services update "$BACKEND_SERVICE" \
  --project "$PROJECT_ID" \
  --global \
  --timeout "$BACKEND_TIMEOUT" >/dev/null

echo "[lb] Ensuring Cloud Armor policy exists..."
if ! gcloud compute security-policies describe "$SECURITY_POLICY" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute security-policies create "$SECURITY_POLICY" \
    --project "$PROJECT_ID" \
    --description "Skill Forge WAF baseline" >/dev/null
fi

retention_header_name_lc="${RETENTION_JOB_EDGE_HEADER_NAME,,}"
retention_shared_header_name_lc="${RETENTION_JOB_EDGE_SHARED_KEY_HEADER_NAME,,}"
retention_path_expr="(request.path.matches('^/api/internal/retention/run/?$') || request.path.matches('^/internal/retention/run/?$'))"
retention_marker_expr="has(request.headers['${retention_header_name_lc}']) && request.headers['${retention_header_name_lc}'] == '${RETENTION_JOB_EDGE_HEADER_VALUE}'"

retention_shared_expr=""
if [[ -n "$RETENTION_JOB_EDGE_SHARED_KEY" ]]; then
  retention_shared_expr=" && has(request.headers['${retention_shared_header_name_lc}']) && request.headers['${retention_shared_header_name_lc}'] == '${RETENTION_JOB_EDGE_SHARED_KEY}'"
fi

retention_source_expr=""
if [[ -n "$RETENTION_JOB_ALLOWED_SOURCE_RANGES" ]]; then
  IFS=',' read -r -a retention_source_ranges <<< "$RETENTION_JOB_ALLOWED_SOURCE_RANGES"
  retention_source_terms=()
  for range in "${retention_source_ranges[@]}"; do
    trimmed="$(echo "$range" | xargs)"
    if [[ -n "$trimmed" ]]; then
      retention_source_terms+=("inIpRange(origin.ip, '${trimmed}')")
    fi
  done

  if [[ "${#retention_source_terms[@]}" -gt 0 ]]; then
    source_joined=""
    for term in "${retention_source_terms[@]}"; do
      if [[ -n "$source_joined" ]]; then
        source_joined="${source_joined} || ${term}"
      else
        source_joined="$term"
      fi
    done
    retention_source_expr=" && (${source_joined})"
  fi
fi

retention_allow_expr="request.method == 'POST' && ${retention_path_expr} && ${retention_marker_expr}${retention_shared_expr}${retention_source_expr}"
retention_deny_expr="${retention_path_expr}"

upsert_rule() {
  local priority="$1"
  local action="$2"
  local expression="$3"
  local description="$4"
  local preview="${5:-false}"
  local preview_flag="--no-preview"

  if [[ "$preview" == "true" ]]; then
    preview_flag="--preview"
  fi

  if gcloud compute security-policies rules describe "$priority" --project "$PROJECT_ID" --security-policy "$SECURITY_POLICY" >/dev/null 2>&1; then
    gcloud compute security-policies rules update "$priority" \
      --project "$PROJECT_ID" \
      --security-policy "$SECURITY_POLICY" \
      --action "$action" \
      --expression "$expression" \
      --description "$description" \
      "$preview_flag" >/dev/null
  else
    gcloud compute security-policies rules create "$priority" \
      --project "$PROJECT_ID" \
      --security-policy "$SECURITY_POLICY" \
      --action "$action" \
      --expression "$expression" \
      --description "$description" \
      "$preview_flag" >/dev/null
  fi
}

echo "[lb] Upserting precise retention endpoint edge rules..."
upsert_rule "$RETENTION_ALLOW_PRIORITY" "allow" "$retention_allow_expr" "Allow retention endpoint only for trusted scheduler pattern"
upsert_rule "$RETENTION_DENY_PRIORITY" "deny-403" "$retention_deny_expr" "Deny all other retention endpoint traffic"

echo "[lb] Upserting baseline WAF rules (mode=${WAF_MODE})..."
upsert_rule 1000 "deny-403" "evaluatePreconfiguredWaf('sqli-v33-stable')" "Block SQL injection signatures" "$WAF_PREVIEW"
upsert_rule 1100 "deny-403" "evaluatePreconfiguredWaf('xss-v33-stable')" "Block XSS signatures" "$WAF_PREVIEW"

gcloud compute backend-services update "$BACKEND_SERVICE" \
  --project "$PROJECT_ID" \
  --global \
  --security-policy "$SECURITY_POLICY" \
  --timeout "$BACKEND_TIMEOUT" >/dev/null

echo "[lb] Ensuring URL map and HTTPS proxy..."
if ! gcloud compute url-maps describe "$URL_MAP" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute url-maps create "$URL_MAP" \
    --project "$PROJECT_ID" \
    --default-service "$BACKEND_SERVICE" >/dev/null
fi

if ! gcloud compute ssl-certificates describe "$SSL_CERT" --project "$PROJECT_ID" --global >/dev/null 2>&1; then
  gcloud compute ssl-certificates create "$SSL_CERT" \
    --project "$PROJECT_ID" \
    --global \
    --domains "$DOMAIN_NAME" >/dev/null
fi

if ! gcloud compute target-https-proxies describe "$HTTPS_PROXY" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute target-https-proxies create "$HTTPS_PROXY" \
    --project "$PROJECT_ID" \
    --ssl-certificates "$SSL_CERT" \
    --url-map "$URL_MAP" >/dev/null
fi

echo "[lb] Ensuring global static IP and forwarding rule..."
if ! gcloud compute addresses describe "$GLOBAL_IP" --project "$PROJECT_ID" --global >/dev/null 2>&1; then
  gcloud compute addresses create "$GLOBAL_IP" \
    --project "$PROJECT_ID" \
    --global \
    --ip-version IPV4 >/dev/null
fi

if ! gcloud compute forwarding-rules describe "$FORWARDING_RULE" --project "$PROJECT_ID" --global >/dev/null 2>&1; then
  gcloud compute forwarding-rules create "$FORWARDING_RULE" \
    --project "$PROJECT_ID" \
    --global \
    --target-https-proxy "$HTTPS_PROXY" \
    --ports 443 \
    --address "$GLOBAL_IP" >/dev/null
fi

LB_IP="$(gcloud compute addresses describe "$GLOBAL_IP" --project "$PROJECT_ID" --global --format='value(address)')"
CERT_STATUS="$(gcloud compute ssl-certificates describe "$SSL_CERT" --project "$PROJECT_ID" --global --format='value(managed.status)')"

echo "[lb] Completed."
echo "[lb] Load balancer IP: ${LB_IP}"
echo "[lb] Managed certificate status: ${CERT_STATUS}"
echo "[lb] Point ${DOMAIN_NAME} A record to ${LB_IP} to activate managed TLS."
echo "[lb] Retention allow rule: priority=${RETENTION_ALLOW_PRIORITY}, header ${RETENTION_JOB_EDGE_HEADER_NAME}=${RETENTION_JOB_EDGE_HEADER_VALUE}"
if [[ -n "$RETENTION_JOB_ALLOWED_SOURCE_RANGES" ]]; then
  echo "[lb] Retention allowed source ranges: ${RETENTION_JOB_ALLOWED_SOURCE_RANGES}"
fi
if [[ -n "$RETENTION_JOB_EDGE_SHARED_KEY" ]]; then
  echo "[lb] Retention shared-key header enforced: ${RETENTION_JOB_EDGE_SHARED_KEY_HEADER_NAME}"
else
  echo "[lb] Retention shared-key header not set. Configure RETENTION_JOB_EDGE_SHARED_KEY for stricter edge filtering."
fi
echo "[lb] Baseline WAF mode: ${WAF_MODE}"
echo "[lb] Backend service timeout: ${BACKEND_TIMEOUT}"
