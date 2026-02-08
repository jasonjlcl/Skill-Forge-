#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-.env.production}"
CERT_DIR="${CERT_DIR:-$REPO_ROOT/certs}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

DOMAIN_NAME="$(grep -E '^DOMAIN_NAME=' "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)"
if [ -z "$DOMAIN_NAME" ]; then
  echo "Missing DOMAIN_NAME in $ENV_FILE" >&2
  exit 1
fi

# If DOMAIN_NAME contains multiple names, the first token is the primary.
DOMAIN_PRIMARY="$(echo "$DOMAIN_NAME" | awk '{print $1}')"

FULLCHAIN="$CERT_DIR/fullchain.pem"
PRIVKEY="$CERT_DIR/privkey.pem"

if [ ! -f "$FULLCHAIN" ]; then
  echo "Missing: $FULLCHAIN" >&2
  exit 1
fi
if [ ! -f "$PRIVKEY" ]; then
  echo "Missing: $PRIVKEY" >&2
  exit 1
fi

echo "Installing certs for $DOMAIN_PRIMARY into cert volume..."

docker compose \
  --env-file "$ENV_FILE" \
  -f docker-compose.prod.yml \
  -f docker-compose.https.yml \
  --profile tls \
  run --no-deps --rm \
  -v "$CERT_DIR:/work:ro" \
  certbot \
  -c "set -e
mkdir -p /etc/letsencrypt/live/$DOMAIN_PRIMARY
cp /work/fullchain.pem /etc/letsencrypt/live/$DOMAIN_PRIMARY/fullchain.pem
cp /work/privkey.pem /etc/letsencrypt/live/$DOMAIN_PRIMARY/privkey.pem
chmod 600 /etc/letsencrypt/live/$DOMAIN_PRIMARY/privkey.pem
ls -l /etc/letsencrypt/live/$DOMAIN_PRIMARY"

echo "OK"

