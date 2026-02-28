#!/usr/bin/env sh
set -eu

: "${SSH_HOST:?SSH_HOST is required}"
: "${SSH_USER:?SSH_USER is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"

DEPLOY_REF="${DEPLOY_REF:-main}"
ENV_FILE="${ENV_FILE:-.env.production}"
ENABLE_HTTPS="${ENABLE_HTTPS:-false}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/deploy_key}"

if [ ! -f "$SSH_KEY_PATH" ]; then
  echo "SSH key not found at $SSH_KEY_PATH" >&2
  exit 1
fi

REMOTE_DEPLOY_SCRIPT='
set -eu
cd "$1"
git fetch --prune origin
git checkout "$2"
if git show-ref --verify --quiet "refs/remotes/origin/$2"; then
  git pull --ff-only origin "$2"
fi
if [ "$4" = "true" ]; then
  docker compose --env-file "$3" -f docker-compose.prod.yml -f docker-compose.https.yml up -d --build
else
  docker compose --env-file "$3" -f docker-compose.prod.yml up -d --build
fi
'

ssh -i "$SSH_KEY_PATH" "$SSH_USER@$SSH_HOST" sh -s -- "$DEPLOY_PATH" "$DEPLOY_REF" "$ENV_FILE" "$ENABLE_HTTPS" <<EOF
$REMOTE_DEPLOY_SCRIPT
EOF
