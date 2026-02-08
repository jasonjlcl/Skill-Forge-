# GenAI Onboarding Platform

Web-based training platform for manufacturing SMEs with:
- JWT auth and secure cookie sessions
- SSE chat tutoring with retrieval context
- Explainability and source-backed responses
- AI-generated quizzes with analytics
- PostgreSQL + ChromaDB support

## Stack

- Frontend: React + Vite + TypeScript + Tailwind
- Backend: Node.js + Express + TypeScript
- Data: PostgreSQL (Drizzle ORM)
- Vector store: ChromaDB
- LLM: Gemini (primary) / OpenAI (fallback)

## Local development

1. Install dependencies:

```bash
npm install
npm --prefix server install
npm --prefix client install
```

2. Configure env:

```bash
cp .env.example .env
```

3. Run migrations (optional but recommended):

```bash
npm run migrate
```

4. Start app:

```bash
npm run dev
```

## Scripts

- `npm run dev` run server + client
- `npm run build` build server + client
- `npm run build:server` build API only
- `npm run build:client` build SPA only
- `npm run test` run server tests
- `npm run lint` lint server + client
- `npm run ingest -- --path ./training-docs --module "Safety Basics"` ingest docs into vector store
- `npm run migrate` run Drizzle schema push
- `npm run docker:prod:up` build and launch production stack
- `npm run docker:prod:up:tls` launch production stack with TLS/certbot overlay
- `npm run docker:prod:down` stop production stack
- `npm run docker:prod:down:tls` stop production TLS stack
- `npm run docker:prod:logs` stream production logs
- `npm run docker:prod:logs:tls` stream production TLS stack logs

## API routes

Primary (legacy-compatible):
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /chat/session`
- `GET /chat/stream`
- `POST /chat/explain`
- `POST /quiz/start`
- `POST /quiz/answer`
- `GET /me/analytics`
- `GET /health`

Also exposed under `/api/*` in production:
- `GET /api/health` includes DB + Chroma dependency checks

## Environment variables

Use `.env.example` for local and `.env.production.example` for deployment.

Required/important:
- `NODE_ENV`, `PORT`
- `DATABASE_URL` (or `POSTGRES_HOST` + `POSTGRES_PORT` + `POSTGRES_USER` + `POSTGRES_PASSWORD` + `POSTGRES_DB`)
- `JWT_SECRET`
- `CORS_ORIGIN`
- `GEMINI_API_KEY` and/or `OPENAI_API_KEY`
- `CHROMA_URL`, `CHROMA_COLLECTION`
- `RATE_LIMIT_MAX`, `REQUEST_BODY_LIMIT`
- `COOKIE_SECURE`

## Production deployment (VPS)

### 1) DNS

Point your domain (for example `app.example.com`) to your VPS public IP:
- `A` record: `app.example.com -> <VPS_IP>`

### 2) Server prerequisites

Install on VPS:
- Docker Engine
- Docker Compose plugin

### 3) Deploy app

```bash
git clone <your-repo-url>
cd genai-onboarding-platform
cp .env.production.example .env.production
# edit .env.production with real secrets and domain values
npm run docker:prod:up
```

This launches:
- `postgres` with persistent named volume
- `chroma` with persistent named volume
- `migrate` one-off service (`npm run migrate`)
- `api` (Express app)
- `web` (Nginx serving SPA + reverse proxy)

If your repo is on OneDrive/Windows reparse-point storage and Docker BuildKit fails, use legacy build mode:

```powershell
$env:DOCKER_BUILDKIT='0'
$env:COMPOSE_DOCKER_CLI_BUILD='0'
npm run docker:prod:up
```

### 4) Health checks

- Nginx liveness: `GET /health`
- API dependency health: `GET /api/health`

### 5) Update procedure

```bash
git pull
npm run docker:prod:up
```

### 6) Rollback

Use previous git commit/tag and redeploy:

```bash
git checkout <previous-tag-or-commit>
npm run docker:prod:up
```

### 7) Back up Postgres

Example backup command:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F).sql
```

Restore:

```bash
cat backup-YYYY-MM-DD.sql | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

## HTTPS readiness

### Option A: Nginx + Let's Encrypt (Certbot)

This repo includes a TLS overlay compose file: `docker-compose.https.yml`.

1. Set domain env values in `.env.production`:
   - `DOMAIN_NAME=app.example.com`
   - `CORS_ORIGIN=https://app.example.com`
   - `CLIENT_URL=https://app.example.com`
   - `CERTBOT_EMAIL=admin@app.example.com`
2. Start stack with TLS overlay in HTTP mode first:
   - `ENABLE_TLS=false`
   - `COOKIE_SECURE=false`
   - `npm run docker:prod:up:tls`
3. Issue certificate with webroot challenge:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.https.yml --profile tls run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN_NAME" --email "$CERTBOT_EMAIL" --agree-tos --no-eff-email
```

4. Enable TLS and secure cookies:
   - `ENABLE_TLS=true`
   - `COOKIE_SECURE=true`
5. Recreate stack:
   - `npm run docker:prod:up:tls`

The `certbot` service in the TLS profile performs periodic renewals (`certbot renew` loop).

Suggested HTTPS Nginx directives:
- `listen 443 ssl http2;`
- `ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;`
- `ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;`
- `return 301 https://$host$request_uri;` in port 80 server block

### Option C: Commercial Certificate (PositiveSSL, etc.)

If you already have an issued certificate + matching private key (for example PositiveSSL), you can skip Certbot issuance.

1. Create `certs/fullchain.pem` and `certs/privkey.pem`:
   - `fullchain.pem` should be your leaf cert followed by the CA bundle/intermediate(s).
2. Copy certs into the Docker cert volume:

```bash
sh scripts/prod/install-positive-ssl-to-volume.sh
```

3. Start the stack with the HTTPS overlay (without enabling the `tls` profile):

```bash
npm run docker:prod:up:https
```

`docker:prod:up:tls` is only needed for the Certbot profile.

### Option B: Managed reverse proxy/CDN

Run this stack behind a managed edge (for example Cloudflare, Render edge proxy, or managed LB):
- Terminate TLS at edge
- Forward traffic to VPS `web` container on port `80`
- Preserve `X-Forwarded-Proto` and `Host` headers
- Keep `COOKIE_SECURE=true`

## CI/CD

GitHub Actions workflow is included at:
- `.github/workflows/ci-cd.yml`

It performs:
- lint + tests + builds
- Docker image build
- optional GHCR push on `main`
- deploy job template for SSH-based VPS rollout

