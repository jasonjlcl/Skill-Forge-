#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-.env.production}"

# Legacy build is needed on some Windows/OneDrive setups; harmless elsewhere.
export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-0}"
export COMPOSE_DOCKER_CLI_BUILD="${COMPOSE_DOCKER_CLI_BUILD:-0}"

docker compose \
  --env-file "$ENV_FILE" \
  -f docker-compose.prod.yml \
  -f docker-compose.https.yml \
  up -d --build

