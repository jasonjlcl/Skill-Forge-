# Rollback Playbook

This playbook is used by the CI production deploy job and can also be run manually.

## Trigger conditions

Rollback is required when one of the following happens after deploy:
- `npm run smoke:auth -- <base_url>` fails
- `/health` or `/api/health` checks fail
- Significant auth/chat regression is detected immediately post-release

## Automated rollback flow (CI)

1. `deploy-production` captures current commit with:
   - `git rev-parse HEAD` on the remote server
2. Workflow deploys the requested `deploy_ref`
3. Workflow runs smoke tests against `SMOKE_BASE_URL`
4. If smoke fails, workflow executes:
   - `sh scripts/prod/rollback-remote.sh`
   - `ROLLBACK_REF=<captured_previous_ref>`
5. Workflow marks production deploy as failed after rollback

## Manual rollback command

Set the required env vars and execute:

```sh
SSH_HOST=your-host \
SSH_USER=your-user \
DEPLOY_PATH=/srv/skill-forge \
ROLLBACK_REF=<previous_commit_sha_or_tag> \
ENV_FILE=.env.production \
ENABLE_HTTPS=true \
SSH_KEY_PATH=$HOME/.ssh/deploy_key \
sh scripts/prod/rollback-remote.sh
```

## Required production environment secrets

- `SSH_HOST`
- `SSH_USER`
- `SSH_KEY`
- `DEPLOY_PATH`
- `SMOKE_BASE_URL`

## Optional production environment variables

- `DEPLOY_ENV_FILE` (default `.env.production`)
- `ENABLE_HTTPS` (`true` to include `docker-compose.https.yml`)

## Post-rollback verification

Run:

```sh
node scripts/auth-smoke.mjs https://your-domain
```

Confirm:
- auth register/login/me flow passes
- `/health` and `/api/health` return success
- logs show stable request success rates and no boot loops
