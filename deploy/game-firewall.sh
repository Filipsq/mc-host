#!/usr/bin/env bash
# Keeps game servers, which run players' plugins and mods, away from the cloud
# provider's metadata service and from the tunnel between our machines, and
# limits what they can send out, so a bad plugin can't send spam or attack
# others from our addresses (the provider would block the whole machine).
# setup.sh and node-setup.sh install it as a service that runs whenever Docker
# starts (Docker rebuilds its firewall rules then).
set -euo pipefail

if [ "${1:-}" = install ]; then
  install -m 755 "$0" /usr/local/sbin/mchost-game-firewall
  cat > /etc/systemd/system/mchost-game-firewall.service <<'UNIT'
[Unit]
Description=Keep game servers away from the metadata service and the tunnel, and limit what they send
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

# Limits per game server (each has its own address on the bridge), for what it sends:
# - no mail straight to mail servers (port 25): that's only ever spam;
# - at most 50 new outgoing connections a second (bursts of 200 for downloading mods
#   at start): scans and connection floods stop there;
# - at most 12 MB/s (about 100 Mbit/s) out, including what it sends to its players
#   (a player needs about 1 Mbit/s), so it can't flood anyone.
# The chain is filled anew on every run, so changing a number here and running it again applies it.
iptables -N MCHOST-EGRESS 2>/dev/null || iptables -F MCHOST-EGRESS
iptables -A MCHOST-EGRESS -p tcp --dport 25 -j DROP
iptables -A MCHOST-EGRESS -m conntrack --ctstate NEW -m hashlimit --hashlimit-mode srcip \
  --hashlimit-above 50/sec --hashlimit-burst 200 --hashlimit-name mchost-new -j DROP
iptables -A MCHOST-EGRESS -m hashlimit --hashlimit-mode srcip \
  --hashlimit-above 12mb/s --hashlimit-burst 24mb --hashlimit-name mchost-bytes -j DROP
for bridge in docker0 mchost0; do
  iptables -C DOCKER-USER -i "$bridge" -j MCHOST-EGRESS 2>/dev/null ||
    iptables -I DOCKER-USER -i "$bridge" -j MCHOST-EGRESS
done
