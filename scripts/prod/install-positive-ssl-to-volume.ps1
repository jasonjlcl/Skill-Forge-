Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..' '..')
Set-Location $repoRoot

$envFile = if ($env:ENV_FILE) { $env:ENV_FILE } else { '.env.production' }
$certDir = if ($env:CERT_DIR) { $env:CERT_DIR } else { (Join-Path $repoRoot 'certs') }

if (-not (Test-Path $envFile)) {
  throw "Missing env file: $envFile"
}

$domainLine =
  Get-Content $envFile |
  Where-Object { $_ -match '^DOMAIN_NAME=' } |
  Select-Object -First 1

if (-not $domainLine) {
  throw "Missing DOMAIN_NAME in $envFile"
}

$domain = $domainLine -replace '^DOMAIN_NAME=', ''
$domainPrimary = ($domain -split '\\s+')[0]
if (-not $domainPrimary) {
  throw "Invalid DOMAIN_NAME in $envFile"
}

$fullchain = Join-Path $certDir 'fullchain.pem'
$privkey = Join-Path $certDir 'privkey.pem'

if (-not (Test-Path $fullchain)) { throw "Missing: $fullchain" }
if (-not (Test-Path $privkey)) { throw "Missing: $privkey" }

$installCmd = @"
set -e
mkdir -p /etc/letsencrypt/live/$domainPrimary
cp /work/fullchain.pem /etc/letsencrypt/live/$domainPrimary/fullchain.pem
cp /work/privkey.pem /etc/letsencrypt/live/$domainPrimary/privkey.pem
chmod 600 /etc/letsencrypt/live/$domainPrimary/privkey.pem
ls -l /etc/letsencrypt/live/$domainPrimary
"@

Write-Host "Installing certs for $domainPrimary into cert volume..."

& docker compose `
  --env-file $envFile `
  -f docker-compose.prod.yml `
  -f docker-compose.https.yml `
  --profile tls `
  run --no-deps --rm `
  -v "${certDir}:/work:ro" `
  certbot `
  -c $installCmd

Write-Host 'OK'

