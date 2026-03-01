#!/usr/bin/env bash
set -euo pipefail

INSTANCE_NAME="${1:?Usage: setup-https-lb-cloud-armor.sh <instance-name> <zone> <domain> [prefix] [target-tag]}"
ZONE="${2:?Usage: setup-https-lb-cloud-armor.sh <instance-name> <zone> <domain> [prefix] [target-tag]}"
DOMAIN_NAME="${3:?Usage: setup-https-lb-cloud-armor.sh <instance-name> <zone> <domain> [prefix] [target-tag]}"
PREFIX="${4:-skillforge-prod}"
TARGET_TAG="${5:-skillforge-web}"

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
    --timeout 30s >/dev/null
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

echo "[lb] Ensuring Cloud Armor policy exists..."
if ! gcloud compute security-policies describe "$SECURITY_POLICY" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute security-policies create "$SECURITY_POLICY" \
    --project "$PROJECT_ID" \
    --description "Skill Forge WAF baseline" >/dev/null
fi

if ! gcloud compute security-policies rules describe 1000 --project "$PROJECT_ID" --security-policy "$SECURITY_POLICY" >/dev/null 2>&1; then
  gcloud compute security-policies rules create 1000 \
    --project "$PROJECT_ID" \
    --security-policy "$SECURITY_POLICY" \
    --action deny-403 \
    --expression "evaluatePreconfiguredWaf('sqli-v33-stable')" \
    --description "Block SQL injection signatures" >/dev/null
fi

if ! gcloud compute security-policies rules describe 1100 --project "$PROJECT_ID" --security-policy "$SECURITY_POLICY" >/dev/null 2>&1; then
  gcloud compute security-policies rules create 1100 \
    --project "$PROJECT_ID" \
    --security-policy "$SECURITY_POLICY" \
    --action deny-403 \
    --expression "evaluatePreconfiguredWaf('xss-v33-stable')" \
    --description "Block XSS signatures" >/dev/null
fi

gcloud compute backend-services update "$BACKEND_SERVICE" \
  --project "$PROJECT_ID" \
  --global \
  --security-policy "$SECURITY_POLICY" >/dev/null

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
