#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-.env.production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

DOMAIN_NAME="$(grep -E '^DOMAIN_NAME=' "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)"
if [ -z "$DOMAIN_NAME" ]; then
  echo "Missing DOMAIN_NAME in $ENV_FILE" >&2
  exit 1
fi

DOMAIN_PRIMARY="$(echo "$DOMAIN_NAME" | awk '{print $1}')"

echo "Checking https://$DOMAIN_PRIMARY ..."
curl -fsS "https://$DOMAIN_PRIMARY/health" | cat
echo
curl -fsS "https://$DOMAIN_PRIMARY/api/health" | cat
echo

