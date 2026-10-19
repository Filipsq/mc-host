#!/usr/bin/env bash
# Points the machine's DNS at public resolvers. Some providers' own resolvers
# time out now and then (seen on netcup), which made game servers fail to
# download Paper and plugins; Docker passes the host's resolvers on to them.
# setup.sh and node-setup.sh run it.
set -euo pipefail
[ -d /run/systemd/resolve ] || exit 0 # not using systemd-resolved
mkdir -p /etc/systemd/resolved.conf.d
conf=/etc/systemd/resolved.conf.d/mchost.conf
want=$'[Resolve]\nDNS=1.1.1.1 9.9.9.9\nFallbackDNS=8.8.8.8\nDomains=~.'
if [ "$(cat "$conf" 2>/dev/null)" != "$want" ]; then
  printf '%s\n' "$want" > "$conf"
  systemctl restart systemd-resolved
fi

# Game servers get their resolvers from Docker, which copies every resolver the
# host knows, the provider's first. Docker's own setting puts the public ones
# first for every container; it takes effect when Docker next restarts.
daemon=/etc/docker/daemon.json
if [ -d /etc/docker ] && ! grep -q '"dns"' "$daemon" 2>/dev/null; then
  python3 - "$daemon" <<'PY'
import json, os, sys
path = sys.argv[1]
cfg = json.load(open(path)) if os.path.exists(path) and os.path.getsize(path) else {}
cfg["dns"] = ["1.1.1.1", "9.9.9.9", "8.8.8.8"]
json.dump(cfg, open(path, "w"), indent=2)
PY
  echo "Docker: public DNS set; it applies after 'systemctl restart docker' or a reboot."
fi
