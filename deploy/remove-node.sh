#!/usr/bin/env bash
# Takes an extra game machine out of use, as root on the MAIN machine:
#   cd ~/mc-host/deploy && ./remove-node.sh n2
# First it lists the servers still on it: move each with the admin panel's
# "Przenieś na inną maszynę" (or delete it) and run this again. With none left, it
# drops the machine from NODES and the tunnel and restarts the site, so nothing new
# goes there. The machine itself isn't touched: cancel it at its host afterwards.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Run this on the main machine, in ~/mc-host/deploy." >&2; exit 1; }
NODE_ID=${1:-}
if [ -z "$NODE_ID" ] || [ "$NODE_ID" = main ]; then
  echo "Usage: ./remove-node.sh <id>   (e.g. n2; not main)" >&2
  exit 1
fi
if ! grep '^NODES=' .env | grep -q "\"id\":\"$NODE_ID\""; then
  echo "$NODE_ID isn't in NODES: nothing to remove." >&2
  exit 1
fi

left=$(docker compose exec -T db psql -U mchost -d mchost -tA -F ' | ' -c \
  "SELECT s.name, s.plan, s.status, u.email FROM \"Server\" s JOIN \"User\" u ON u.id = s.\"ownerId\" WHERE s.node = '$NODE_ID' ORDER BY s.plan, s.name")
if [ -n "$left" ]; then
  echo "Still on $NODE_ID (move each in Admin > Serwery > Przenieś na inną maszynę, then run this again):"
  echo "$left" | sed 's/^/  /'
  exit 1
fi

cp .env ".env.before-remove-$NODE_ID"
python3 - "$NODE_ID" <<'PY'
import json, sys
node_id = sys.argv[1]
out = []
for line in open(".env").read().splitlines():
    if line.startswith("NODES="):
        listed = [n for n in json.loads(line[len("NODES="):].strip("'")) if n.get("id") != node_id]
        line = "NODES='" + json.dumps(listed, separators=(",", ":")) + "'"
    out.append(line)
open(".env", "w").write("\n".join(out) + "\n")
PY

# Its tunnel entry goes too.
if grep -qx "# $NODE_ID" /etc/wireguard/wg0.conf; then
  cp /etc/wireguard/wg0.conf "/etc/wireguard/wg0.conf.before-remove-$NODE_ID"
  awk -v id="# $NODE_ID" '
    $0 == id {skip = 1; next}
    skip && /^# / {skip = 0}
    skip && /^\[Peer\]/ {next}
    !skip {print}
  ' "/etc/wireguard/wg0.conf.before-remove-$NODE_ID" > /etc/wireguard/wg0.conf
  wg syncconf wg0 <(wg-quick strip wg0)
fi
mv "nodes/$NODE_ID.env" "nodes/$NODE_ID.env.removed" 2>/dev/null || true

docker compose up -d >/dev/null
echo "$NODE_ID removed: no new servers go there. You can now cancel the machine at its host,"
echo "and delete the DNS record $NODE_ID.mchosting.pl if you made one."
