#!/usr/bin/env bash
# Updates every extra game machine at once, as root on the MAIN machine, after a site update:
#   cd ~/mc-host && git pull && cd deploy && ./setup.sh && ./update-nodes.sh
# It builds the agent once for each processor type, then runs ./add-node.sh for all the
# machines listed in NODES at the same time and restarts the site once at the end.
# A machine that still asks for its password is updated after the others, one at a time.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Run ./setup.sh first: this is for the main machine." >&2; exit 1; }

# id, processor and address of each machine in NODES.
mapfile -t rows < <(python3 - <<'PY'
import json
line = next((l for l in open(".env").read().splitlines() if l.startswith("NODES=")), None)
for n in json.loads(line[len("NODES="):].strip("'")) if line else []:
    print(n["id"], n.get("arch") or "-")
PY
)
if [ "${#rows[@]}" -eq 0 ]; then
  echo "No extra machines in NODES, nothing to update."
  exit 0
fi

ids=() targets=() failed=()
for row in "${rows[@]}"; do
  id=${row%% *}
  target=""
  if [ -f "nodes/$id.env" ]; then
    target=$(grep '^NODE_TARGET=' "nodes/$id.env" | cut -d= -f2 || true)
  fi
  if [ -z "$target" ]; then
    # Added before add-node.sh noted the address: take it from the tunnel and find the user.
    ip=$(awk -v id="# $id" '$0 == id {found = 1} found && /^Endpoint/ {split($3, a, ":"); print a[1]; exit}' /etc/wireguard/wg0.conf || true)
    if [ -n "$ip" ]; then
      target="root@$ip"
      for user in root ubuntu; do
        if ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$user@$ip" true 2>/dev/null; then
          target="$user@$ip"
          break
        fi
      done
    fi
  fi
  if [ -z "$target" ]; then
    echo "$id: don't know its address, run ./add-node.sh $id <user>@<IP> once." >&2
    failed+=("$id")
    continue
  fi
  ids+=("$id") targets+=("$target")
done

for arch in $(printf '%s\n' "${rows[@]}" | awk '$2 != "-" {print $2}' | sort -u); do
  echo "Building the agent ($arch)..."
  docker build -q --platform "linux/$arch" -t "mchost-node-agent:$arch" ../agent >/dev/null
done

logs=$(mktemp -d)
pids=() quiet=() asks=()
for i in "${!ids[@]}"; do
  id=${ids[$i]} target=${targets[$i]}
  if ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$target" true 2>/dev/null; then
    echo "$id ($target): updating..."
    SKIP_BUILD=1 NO_RESTART=1 ./add-node.sh "$id" "$target" </dev/null >"$logs/$id.log" 2>&1 &
    pids+=($!) quiet+=("$id")
  else
    asks+=("$i")
  fi
done

for i in "${!pids[@]}"; do
  id=${quiet[$i]}
  if wait "${pids[$i]}"; then
    echo "$id: done ($(grep 'MB for servers' "$logs/$id.log" || echo updated))"
  else
    failed+=("$id")
    echo "$id: FAILED, last lines:"
    tail -n 15 "$logs/$id.log" | sed 's/^/    /'
  fi
done

for i in "${asks[@]}"; do
  id=${ids[$i]} target=${targets[$i]}
  echo "$id ($target): asks for its password, updating it on its own..."
  if ! SKIP_BUILD=1 NO_RESTART=1 ./add-node.sh "$id" "$target"; then
    failed+=("$id")
  fi
done
rm -rf "$logs"

docker compose up -d >/dev/null
if [ "${#failed[@]}" -gt 0 ]; then
  echo "Not updated: ${failed[*]}. Run ./add-node.sh <id> <user>@<IP> for each to see why." >&2
  exit 1
fi
echo "All machines updated."
