#!/usr/bin/env bash
# Sets up (and updates) an EXTRA game machine. Don't run it by hand: deploy/add-node.sh
# on the main machine copies it here and runs it with the tunnel keys and agent token.
set -euo pipefail
cd "$(dirname "$0")/node"

if [ "$#" -lt 1 ] || ! mapfile -t f < <(echo "$1" | base64 -d) || [ "${#f[@]}" -ne 6 ]; then
  echo "Run ./add-node.sh on the main machine instead (see deploy/README.md)." >&2
  exit 1
fi
NODE_ID=${f[0]} NODE_WG=${f[1]} NODE_KEY=${f[2]} MAIN_PUB=${f[3]} MAIN_IP=${f[4]} AGENT_TOKEN=${f[5]}

export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi
apt-get install -y -qq wireguard-tools ufw >/dev/null

echo "Connecting the tunnel to the main machine..."
umask 077
cat > /etc/wireguard/wg0.conf <<CONF
[Interface]
Address = $NODE_WG/24
ListenPort = 51820
PrivateKey = $NODE_KEY

[Peer]
PublicKey = $MAIN_PUB
AllowedIPs = 10.88.0.1/32
Endpoint = $MAIN_IP:51820
PersistentKeepalive = 25
CONF
umask 022
systemctl enable wg-quick@wg0 >/dev/null
systemctl restart wg-quick@wg0

echo "Configuring the firewall..."
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 51820/udp >/dev/null                       # the tunnel
ufw allow in on wg0 to any port 8081 proto tcp >/dev/null  # the site, through the tunnel only
ufw allow in on wg0 to any port 25565 proto tcp >/dev/null # Java players, passed on by the main machine's router
ufw allow 30000:30999/udp >/dev/null # Bedrock players (and crossplay)
ufw allow 30000:30999/tcp >/dev/null # Terraria players
ufw allow 31000:31999/udp >/dev/null # Simple Voice Chat, the server's port + 1000
ufw allow 40000:59999/udp >/dev/null # Bedrock servers play over NetherNet, 20 ports each (agent/nethernet.go)
ufw --force enable >/dev/null
../game-firewall.sh install
../public-dns.sh

if [ ! -f .env ]; then
  # Only the agent runs here, so less is kept back for the system than on the main machine.
  total_mb=$(awk '/^MemTotal/ {print int($2 / 1024)}' /proc/meminfo)
  cat > .env <<ENV
MEMORY_LIMIT_MB=$(( (total_mb - 768) * 85 / 100 / 512 * 512 ))
MEMORY_OVERBOOK=2
# Same key as on the main machine, for CurseForge mod packs (in single quotes).
CF_API_KEY=
ENV
fi
total_mb=$(awk '/^MemTotal/ {print int($2 / 1024)}' /proc/meminfo)
if [ "$total_mb" -lt 6144 ]; then
  # A small machine: free servers get 1.5 GB instead of 2, so two fit at once,
  # with a swap file to fall back on when both grow.
  grep -q '^FREE_SERVER_MEMORY_MB=' .env || echo "FREE_SERVER_MEMORY_MB=1536" >> .env
  if [ ! -f /swapfile ]; then
    echo "Adding a 2 GB swap file..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
fi
# Written every time, from what the main machine sent.
sed -i '/^NODE_ID=/d; /^AGENT_TOKEN=/d; /^AGENT_ADDR=/d' .env
cat >> .env <<ENV
NODE_ID=$NODE_ID
AGENT_TOKEN=$AGENT_TOKEN
AGENT_ADDR=$NODE_WG:8081
ENV
chmod 600 .env

if [ "${2:-}" = prebuilt ]; then
  # add-node.sh built the agent on the main machine and loaded it here.
  echo "Starting the agent..."
  docker compose up -d
else
  echo "Building and starting the agent (the first build takes a few minutes)..."
  docker compose up -d --build
fi
docker image prune -f >/dev/null
docker builder prune -f >/dev/null
