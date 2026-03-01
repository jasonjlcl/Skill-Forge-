#!/usr/bin/env bash
set -euo pipefail

INSTANCE_NAME="${1:?Usage: install-ops-agent.sh <instance-name> <zone>}"
ZONE="${2:?Usage: install-ops-agent.sh <instance-name> <zone>}"

read -r -d '' REMOTE_SCRIPT <<'EOS' || true
set -euo pipefail

if ! command -v google-cloud-ops-agent >/dev/null 2>&1; then
  curl -sS -o /tmp/add-google-cloud-ops-agent-repo.sh \
    https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
  sudo bash /tmp/add-google-cloud-ops-agent-repo.sh --also-install
fi

sudo tee /etc/google-cloud-ops-agent/config.yaml >/dev/null <<'EOF'
logging:
  receivers:
    docker_json_logs:
      type: files
      include_paths:
        - /var/lib/docker/containers/*/*-json.log
      record_log_file_path: true
  processors:
    parse_container_json:
      type: parse_json
      field: message
      time_key: time
      severity_key: level
  service:
    pipelines:
      containers:
        receivers: [docker_json_logs]
        processors: [parse_container_json]

metrics:
  receivers:
    hostmetrics:
      type: hostmetrics
      collection_interval: 60s
  service:
    pipelines:
      default_pipeline:
        receivers: [hostmetrics]
EOF

sudo systemctl restart google-cloud-ops-agent
sudo systemctl --no-pager --full status google-cloud-ops-agent | head -n 40
EOS

echo "[ops-agent] Installing/configuring on ${INSTANCE_NAME} (${ZONE})..."
gcloud compute ssh "$INSTANCE_NAME" \
  --zone "$ZONE" \
  --quiet \
  --command "$REMOTE_SCRIPT"

echo "[ops-agent] Completed."
