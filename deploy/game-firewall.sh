#!/usr/bin/env bash
# Keeps game servers, which run players' plugins and mods, away from the cloud
# provider's metadata service and from the tunnel between our machines.
# setup.sh and node-setup.sh install it as a service that runs whenever Docker
# starts (Docker rebuilds its firewall rules then).
set -euo pipefail

if [ "${1:-}" = install ]; then
  install -m 755 "$0" /usr/local/sbin/mchost-game-firewall
  cat > /etc/systemd/system/mchost-game-firewall.service <<'UNIT'
[Unit]
Description=Keep game servers away from the metadata service and the tunnel
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/mchost-game-firewall

[Install]
WantedBy=docker.service
UNIT
  systemctl daemon-reload
  systemctl enable mchost-game-firewall >/dev/null 2>&1
  systemctl restart mchost-game-firewall
  exit 0
fi

# Docker makes the DOCKER-USER chain when it starts.
for _ in $(seq 1 30); do
  iptables -n -L DOCKER-USER >/dev/null 2>&1 && break
  sleep 1
done
# docker0: servers made before their own network existed; mchost0: the game network (agent/main.go).
for bridge in docker0 mchost0; do
  for dest in 169.254.169.254/32 10.88.0.0/24; do
    iptables -C DOCKER-USER -i "$bridge" -d "$dest" -j DROP 2>/dev/null ||
      iptables -I DOCKER-USER -i "$bridge" -d "$dest" -j DROP
  done
done
