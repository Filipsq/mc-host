package main

import (
	"fmt"
	"log"
	"net"
)

// Bedrock 26.60 (27.10.2026) drops RakNet, the UDP-only way games used to
// connect, for NetherNet: the game asks the server's port over HTTP (TCP)
// first, then plays over WebRTC on UDP at an address the server hands back.
// See https://geysermc.org/blog/preparing-for-nethernet and the NetherNet part
// of https://github.com/itzg/docker-minecraft-bedrock-server.

// Mojang's server plays over one UDP port per player, from a range of its own:
// bedrockPlayPortBase plus bedrockPlayPortsEach ports for each of the 1000
// server ports (40000-59999 for the usual pool).
const (
	bedrockPlayPortBase  = 40000
	bedrockPlayPortsEach = 20
)

// bedrockPlayPorts is the range a Bedrock server plays over (both ends included).
func (req *createRequest) bedrockPlayPorts() (first, last int) {
	first = bedrockPlayPortBase + req.Port%1000*bedrockPlayPortsEach
	return first, first + bedrockPlayPortsEach - 1
}

// lookupIPv4 is the machine's public address for a host name, "" if unknown.
var lookupIPv4 = func(host string) string {
	ips, err := net.LookupIP(host)
	if err != nil {
		log.Printf("nethernet: look up %s: %v", host, err)
		return ""
	}
	for _, ip := range ips {
		if v4 := ip.To4(); v4 != nil {
			return v4.String()
		}
	}
	return ""
}

// geyserNetherNetOpts turns NetherNet on in Geyser. It plays on the same UDP
// port as before; from inside the container it can't see the machine's public
// address, so it's told which one to give the game (the one voice chat uses).
func geyserNetherNetOpts(req createRequest) string {
	opts := "-DgeyserTransport=nethernet"
	if req.VoiceHost != "" {
		if ip := lookupIPv4(req.VoiceHost); ip != "" {
			opts += fmt.Sprintf(" -DgeyserAdvertiseAddresses=%s:%d", ip, req.Port)
		}
	}
	return opts
}
