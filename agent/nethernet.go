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

// publicIPv4 is this machine's own public IPv4 address, "" if it can't tell:
// the address it sends from to the internet (the agent shares the machine's
// network, and our machines have their public address on the interface).
// Mojang's server tells it to the game. Without it the image asks ipify at
// every start, and when ipify doesn't answer the server never starts
// ("Unable to resolve public IP", n5 on 2026-11-03).
var publicIPv4 = func() string {
	conn, err := net.Dial("udp4", "1.1.1.1:53") // UDP: no packet is sent
	if err != nil {
		log.Printf("nethernet: own address: %v", err)
		return ""
	}
	defer conn.Close()
	ip := conn.LocalAddr().(*net.UDPAddr).IP.To4()
	if ip == nil || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return ""
	}
	return ip.String()
}

// bedrockUDPAddress is what the server hands the game to play on: our own
// address, or the image's placeholder for it (IPv4: game ports are IPv4 here).
func bedrockUDPAddress() string {
	if ip := publicIPv4(); ip != "" {
		return ip
	}
	return "<public_ipv4>"
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
