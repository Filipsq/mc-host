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
