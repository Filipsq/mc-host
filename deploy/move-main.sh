#!/usr/bin/env bash
# Moves the main machine's job (website, database, Caddy, the Java router and the
# WireGuard hub) onto one of the extra game machines, which then becomes "main".
# Run as root on the CURRENT main machine, in two steps:
#   ./move-main.sh prepare n5   any time: copies the code there and builds it (site stays up)
#   ./move-main.sh switch n5    at night: the site is down for a few minutes while it moves
# Before "switch", move every game server off this machine (admin "Przenieś"), so
# none is left behind. After it, point the DNS records @ and * at the new machine.
# The old machine keeps its data untouched, so going back is possible (see the end).
set -euo pipefail
cd "$(dirname "$0")"

STEP="${1:-}"
NODE_ID="${2:-}"
if [[ ! "$STEP" =~ ^(prepare|switch)$ || -z "$NODE_ID" || ! -f "nodes/$NODE_ID.env" ]]; then
  echo "Usage: ./move-main.sh prepare|switch <id of an added machine, e.g. n5>" >&2
  exit 1
fi
[ -f .env ] || { echo "Run this on the main machine (deploy/.env is missing)." >&2; exit 1; }
TARGET=$(grep '^NODE_TARGET=' "nodes/$NODE_ID.env" | cut -d= -f2)
[[ "$TARGET" == root@* ]] || { echo "$NODE_ID must be reached as root (it's $TARGET)." >&2; exit 1; }
NEW_IP=${TARGET#root@}
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 "$TARGET")
if ! "${SSH[@]}" true; then
  echo "Can't log in to $TARGET without a password. Run once: ssh-copy-id $TARGET" >&2
  exit 1
fi

# The whole code (with .git, so "git pull" works there too), without build leftovers.
copy_code() {
  tar -C ~ -cz --exclude=mc-host/node_modules --exclude=mc-host/.next --exclude=mc-host/deploy/.env \
    --exclude=mc-host/deploy/nodes mc-host | "${SSH[@]}" 'tar -xz -C ~'
}

if [ "$STEP" = prepare ]; then
  echo "Copying the code to $NODE_ID..."
  copy_code
  echo "Building the site and the agent there (takes a while; the site here stays up)..."
  # A copy of .env without secrets that matter for building, so compose can read it.
  "${SSH[@]}" "cd ~/mc-host/deploy && touch .env && docker compose build web agent"
  left=$(docker ps -a --filter label=mchost.server --format '{{.Names}}' | wc -l)
  echo
  echo "Ready. Game servers still on this machine: $left."
  [ "$left" -eq 0 ] || echo "Move them in the admin panel (Przenieś) to $NODE_ID before ./move-main.sh switch $NODE_ID."
  exit 0
fi

left=$(docker ps -a --filter label=mchost.server --format '{{.Names}}')
if [ -n "$left" ]; then
  echo "These game servers are still on this machine; move them first (admin, Przenieś):" >&2
  echo "$left" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "Stopping the site here (players and the panel are offline from now)..."
docker compose stop caddy web billing-cron agent

echo "Saving the database..."
docker compose exec -T db pg_dump -U mchost -Fc mchost > "$work/db.dump"
docker compose stop db

echo "Saving the HTTPS certificates..."
docker run --rm -v mchost_caddy-data:/d alpine tar -cz -C /d . > "$work/caddy.tgz"

# The settings, without the new main in NODES and with its own memory worked out again.
python3 - "$NODE_ID" > "$work/.env" <<'PY'
import json, sys
node_id = sys.argv[1]
for line in open(".env").read().splitlines():
    if line.startswith("NODES="):
        listed = [n for n in json.loads(line[len("NODES="):].strip("'")) if n.get("id") != node_id]
        line = "NODES='" + json.dumps(listed, separators=(",", ":")) + "'"
    if line.startswith("MEMORY_LIMIT_MB="):
        continue  # setup.sh works it out for the new machine's RAM
    print(line)
PY

# The tunnel hub: same keys, so the other machines keep trusting it; the new main's
# own entry goes (it's the hub now).
awk -v id="# $NODE_ID" '
  $0 == id {skip = 1; next}
  skip && /^# / {skip = 0}
  skip && /^\[Peer\]/ {next}
  !skip {print}
' /etc/wireguard/wg0.conf > "$work/wg0.conf"

echo "Copying everything to $NODE_ID..."
copy_code
tar -C "$work" -c .env db.dump caddy.tgz wg0.conf | "${SSH[@]}" 'mkdir -p /root/move-main && tar -x -C /root/move-main'
tar -C . -c --exclude="nodes/$NODE_ID.env" nodes | "${SSH[@]}" 'tar -x -C ~/mc-host/deploy'
# So the new main can update the other machines without passwords, as this one does.
keys=()
for f in id_ed25519 id_ed25519.pub known_hosts; do [ -f "/root/.ssh/$f" ] && keys+=("$f"); done
[ "${#keys[@]}" -eq 0 ] || tar -C /root/.ssh -c "${keys[@]}" | "${SSH[@]}" 'tar -x -C /root/.ssh && chmod 600 /root/.ssh/id_ed25519 2>/dev/null || true'

echo "Handing over the tunnel..."
systemctl disable --now wg-quick@wg0 >/dev/null

"${SSH[@]}" "NODE_ID=$NODE_ID bash -s" <<'REMOTE'
set -euo pipefail
cd ~/mc-host/deploy
m=/root/move-main
install -m 600 "$m/wg0.conf" /etc/wireguard/wg0.conf
systemctl enable wg-quick@wg0 >/dev/null
systemctl restart wg-quick@wg0
install -m 600 "$m/.env" .env

echo "Restoring the database..."
docker compose up -d db
until docker compose exec -T db pg_isready -h 127.0.0.1 -U mchost >/dev/null 2>&1; do sleep 2; done
# Warnings (e.g. about the public schema) make pg_restore exit non-zero; the count below is the check.
docker compose exec -T db pg_restore -U mchost -d mchost --no-owner --clean --if-exists < "$m/db.dump" || true
users=$(docker compose exec -T db psql -U mchost -d mchost -tAc 'SELECT count(*) FROM "User"')
[ "$users" -gt 0 ] || { echo "The database didn't restore (no users). Nothing else was changed here." >&2; exit 1; }
echo "Restored: $users accounts."
# Servers on this machine were listed under its old name; now it's the main one.
docker compose exec -T db psql -U mchost -d mchost -v ON_ERROR_STOP=1 -c \
  "UPDATE \"Server\" SET node = 'main' WHERE node = '$NODE_ID';
   DELETE FROM \"MachineCost\" WHERE node = 'main';
   UPDATE \"MachineCost\" SET node = 'main' WHERE node = '$NODE_ID';"

echo "Restoring the HTTPS certificates..."
docker volume create mchost_caddy-data >/dev/null
docker run --rm -i -v mchost_caddy-data:/d alpine tar -xz -C /d < "$m/caddy.tgz"

echo "Starting the site here..."
./setup.sh
REMOTE

cat <<INFO

Done: $NEW_IP is now the main machine. Last steps:
1. In your DNS (OVH): change the A records  @  and  *  to  $NEW_IP  (and keep  $NODE_ID  there too).
2. Once https://$(grep '^DOMAIN=' .env | cut -d= -f2) opens from the new machine, on it run:
     cd ~/mc-host/deploy && ./update-nodes.sh
   so the other machines' tunnels point at it for good.
This machine still has everything as it was. To go back (only before the DNS change,
or changes made since are lost): systemctl enable --now wg-quick@wg0 && docker compose up -d
INFO
