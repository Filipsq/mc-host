#!/usr/bin/env bash
# Adds an extra game machine (or updates one added before), as root on the MAIN machine:
#   ./add-node.sh <id> <user>@<the new machine's IP>
# e.g. ./add-node.sh n2 root@203.0.113.7 (Hetzner) or ./add-node.sh n2 ubuntu@203.0.113.7 (OVH).
# The new machine needs a fresh Ubuntu 24.04 at any provider; you'll be asked for its
# password once. This connects the two machines with an encrypted WireGuard tunnel,
# copies the agent there and starts it (deploy/node-setup.sh), then lists the machine
# in NODES in deploy/.env so new servers can go there. See deploy/README.md.
set -euo pipefail
cd "$(dirname "$0")"

NODE_ID="${1:-}"
TARGET="${2:-}"
if [[ ! "$NODE_ID" =~ ^[a-z0-9-]{1,20}$ || "$NODE_ID" == main || ! "$TARGET" =~ ^[a-z_][a-z0-9_-]*@[0-9.]+$ ]]; then
  echo "Usage: ./add-node.sh <id> <user>@<ip>   (e.g. ./add-node.sh n2 root@203.0.113.7)" >&2
  exit 1
fi
NODE_IP="${TARGET#*@}"
[ -f .env ] || { echo "Run ./setup.sh first: this is for the main machine." >&2; exit 1; }
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)

if ! command -v wg >/dev/null; then
  echo "Installing WireGuard..."
  apt-get install -y -qq wireguard-tools >/dev/null
fi

# The tunnel: 10.88.0.1 is this machine, 10.88.0.2 and up the others.
WG=/etc/wireguard/wg0.conf
if [ ! -f "$WG" ]; then
  umask 077
  cat > "$WG" <<CONF
[Interface]
Address = 10.88.0.1/24
ListenPort = 51820
PrivateKey = $(wg genkey)
CONF
  umask 022
  ufw allow 51820/udp >/dev/null
  systemctl enable --now wg-quick@wg0 >/dev/null
fi
MAIN_PUB=$(grep '^PrivateKey' "$WG" | cut -d' ' -f3 | wg pubkey)

# What this machine knows about the other one, kept so running this again updates it.
mkdir -p -m 700 nodes
STATE="nodes/$NODE_ID.env"
if [ ! -f "$STATE" ]; then
  n=2
  while grep -q "AllowedIPs = 10.88.0.$n/32" "$WG"; do n=$((n + 1)); done
  node_key=$(wg genkey)
  umask 077
  cat > "$STATE" <<ENV
NODE_WG=10.88.0.$n
NODE_KEY=$node_key
AGENT_TOKEN=$(openssl rand -hex 32)
ENV
  umask 022
  cat >> "$WG" <<CONF

# $NODE_ID
[Peer]
PublicKey = $(echo "$node_key" | wg pubkey)
AllowedIPs = 10.88.0.$n/32
Endpoint = $NODE_IP:51820
PersistentKeepalive = 25
CONF
  wg syncconf wg0 <(wg-quick strip wg0)
fi
# shellcheck disable=SC1090
source "$STATE"

MAIN_IP=$(curl -fsS4 https://api.ipify.org)
BUNDLE=$(printf '%s\n' "$NODE_ID" "$NODE_WG" "$NODE_KEY" "$MAIN_PUB" "$MAIN_IP" "$AGENT_TOKEN" | base64 -w0)

echo "Copying the agent to $TARGET (you may be asked for its password)..."
SSH=(ssh -o StrictHostKeyChecking=accept-new -o ControlMaster=auto -o "ControlPath=/tmp/mchost-node-%r@%h" -o ControlPersist=120)
tar -C .. -cz agent deploy/node deploy/node-setup.sh | "${SSH[@]}" "$TARGET" 'mkdir -p mc-host && tar -xz -C mc-host'
SUDO=""
[[ "$TARGET" == root@* ]] || SUDO="sudo"
"${SSH[@]}" -t "$TARGET" "$SUDO mc-host/deploy/node-setup.sh $BUNDLE"

echo "Checking that this machine reaches it through the tunnel..."
stats=""
for _ in $(seq 1 30); do
  stats=$(curl -fsS -m 5 -H "Authorization: Bearer $AGENT_TOKEN" "http://$NODE_WG:8081/stats" 2>/dev/null) && break
  sleep 2
done
if [ -z "$stats" ]; then
  echo "Can't reach the agent at $NODE_WG:8081. Check that UDP port 51820 isn't blocked at the provider, then run me again." >&2
  exit 1
fi

# List it in NODES (replacing an earlier entry for the same id) and restart the site with it.
python3 - "$NODE_ID" "$NODE_WG" "$AGENT_TOKEN" "$NODE_ID.$DOMAIN" "$stats" <<'PY'
import json, re, sys
node_id, wg_ip, token, host, stats = sys.argv[1:]
node = {"id": node_id, "url": f"http://{wg_ip}:8081", "token": token, "host": host,
        "memoryLimitMb": json.loads(stats).get("memoryBaseMb", 0)}
with open(".env") as f:
    lines = f.read().splitlines()
current = next((l for l in lines if l.startswith("NODES=")), None)
listed = json.loads(current[len("NODES="):].strip("'")) if current else []
listed = [n for n in listed if n.get("id") != node_id] + [node]
line = "NODES='" + json.dumps(listed, separators=(",", ":")) + "'"
lines = [line if l.startswith("NODES=") else l for l in lines] if current else lines + [
    "# Extra game machines, written by add-node.sh.", line]
with open(".env", "w") as f:
    f.write("\n".join(lines) + "\n")
print(f"{node_id} has {node['memoryLimitMb']} MB for servers.")
PY
docker compose up -d >/dev/null

cat <<INFO

Done: new servers can now go to $NODE_ID.

One more step, in your DNS (OVH): add an A record  $NODE_ID  ->  $NODE_IP
Bedrock and Terraria players join servers on $NODE_ID at $NODE_ID.$DOMAIN.

To update $NODE_ID after a site update, run the same command again.
INFO
