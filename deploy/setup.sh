#!/usr/bin/env bash
# One-time setup (and later updates) on a fresh Ubuntu 24.04 server, as root:
#   git clone https://github.com/Filipsq/mc-host && cd mc-host/deploy && ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi

echo "Configuring the firewall..."
apt-get install -y -qq ufw >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null          # website (redirects to HTTPS)
ufw allow 443/tcp >/dev/null         # website
ufw allow 25565/tcp >/dev/null       # Java players, through the agent's router
ufw allow 30000:30999/udp >/dev/null # Bedrock players, one port per server
ufw --force enable >/dev/null

if [ ! -f .env ]; then
  read -rp "Domain for the site (e.g. mchosting.pl): " DOMAIN
  secret() { openssl rand -hex 32; }
  cat > .env <<ENV
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(secret)
AUTH_SECRET=$(secret)
AGENT_TOKEN=$(secret)
CRON_SECRET=$(secret)
# From Stripe Dashboard → Developers. Leave empty until you're ready to take payments.
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PORT_RANGE_START=30000
PORT_RANGE_END=30999
ENV
  chmod 600 .env
  echo "Wrote deploy/.env with fresh secrets."
fi

echo "Building and starting (the first build takes a few minutes)..."
docker compose up -d --build
docker compose ps
