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
ufw allow 30000:30999/udp >/dev/null # Bedrock players (and crossplay), one port per server
ufw allow 30000:30999/tcp >/dev/null # Terraria players, one port per server
ufw --force enable >/dev/null

if [ ! -f .env ]; then
  # Ask until it looks like a domain: a stray Enter left over from pasting the
  # install commands would otherwise save it empty.
  DOMAIN=""
  until [[ "$DOMAIN" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]]; do
    read -rp "Domain for the site (e.g. mchosting.pl): " DOMAIN
    DOMAIN=$(echo "$DOMAIN" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
  done
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

if ! grep -qE '^DOMAIN=[a-z0-9]' .env; then
  echo "DOMAIN in deploy/.env is empty. Set it with:" >&2
  echo "  sed -i 's/^DOMAIN=.*/DOMAIN=mchosting.pl/' .env" >&2
  exit 1
fi

# How much plan memory all Minecraft servers together may use: the machine's
# RAM minus room for the system, website and database, less a margin for what
# Java needs on top of each plan. Change it in .env (e.g. after moving to a
# bigger machine) and run this script again.
if ! grep -q '^MEMORY_LIMIT_MB=' .env; then
  total_mb=$(awk '/^MemTotal/ {print int($2 / 1024)}' /proc/meminfo)
  echo "MEMORY_LIMIT_MB=$(( (total_mb - 1536) * 85 / 100 / 512 * 512 ))" >> .env
fi
# Paid plans are sold up to this many times that memory, since stopped servers
# use none and Java servers only what their players need (see README.md).
if ! grep -q '^MEMORY_OVERBOOK=' .env; then
  echo "MEMORY_OVERBOOK=1.5" >> .env
fi
echo "Minecraft servers may use up to $(grep '^MEMORY_LIMIT_MB=' .env | cut -d= -f2) MB of memory in total;"
echo "paid plans are sold up to $(grep '^MEMORY_OVERBOOK=' .env | cut -d= -f2) times that."

# Emails (password reset links) go out through Brevo; see deploy/README.md.
if ! grep -q '^BREVO_API_KEY=' .env; then
  cat >> .env <<'ENV'
# From Brevo → SMTP & API → API keys. Without it no emails are sent and
# password reset links only show up in: docker compose logs web
BREVO_API_KEY=
# Sender address; empty means no-reply@ your domain.
MAIL_FROM=
ENV
fi
if ! grep -qE '^BREVO_API_KEY=.+' .env; then
  echo "Emails are off: set BREVO_API_KEY in deploy/.env (see deploy/README.md)."
fi

# The AI server creator uses Claude; see deploy/README.md.
if ! grep -q '^ANTHROPIC_API_KEY=' .env; then
  cat >> .env <<'ENV'
# From console.anthropic.com → API keys. Without it the AI creator is hidden.
ANTHROPIC_API_KEY=
# Which Claude model picks servers, and how often it may be used.
AI_MODEL=claude-opus-5-5
AI_DAILY_LIMIT=10
AI_MONTHLY_LIMIT=1000
ENV
fi
if ! grep -qE '^ANTHROPIC_API_KEY=.+' .env; then
  echo "The AI creator is off: set ANTHROPIC_API_KEY in deploy/.env (see deploy/README.md)."
fi

# CurseForge mod packs on the home page and in the panel; see deploy/README.md.
if ! grep -q '^CF_API_KEY=' .env; then
  cat >> .env <<'ENV'
# From console.curseforge.com, in single quotes (the key contains $).
# Without it CurseForge packs are hidden.
CF_API_KEY=
ENV
fi
if ! grep -qE '^CF_API_KEY=.+' .env; then
  echo "CurseForge packs are off: set CF_API_KEY in deploy/.env (see deploy/README.md)."
fi

echo "Building and starting (the first build takes a few minutes)..."
docker compose up -d --build
docker compose ps

# Each build leaves the previous site and agent images and their build cache
# behind (several GB per update). Drop the leftovers; worlds and backups live
# in volumes and the Minecraft images are in use, so neither is touched.
echo "Removing leftovers from earlier builds..."
docker image prune -f >/dev/null
docker builder prune -f >/dev/null
docker system df
