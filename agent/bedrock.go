package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Bedrock players (a Bedrock server, or a Java server with crossplay) connect
// straight to the server's own UDP port, so the Java router never sees them.
// While such a server's container is stopped, nothing answers on that port and
// the game only says "NetherNet / InitialConnection" after a long wait. The
// UDP waker takes the port over instead: it answers the server list (asleep,
// starting or off) and wakes a sleeping server when a player tries to join,
// as the router does for Java players. It lets the port go just before the
// server starts, so Docker can publish it again.

// RakNet's offline messages, the only part of the protocol the waker speaks.
const (
	rakUnconnectedPing     = 0x01
	rakUnconnectedPingOpen = 0x02
	rakUnconnectedPong     = 0x1c
	rakOpenConnRequest1    = 0x05
)

var rakMagic = []byte{0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe, 0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78}

// Shown in the Bedrock server list (first line) under the server's name.
const (
	bedrockMsgSleeping = "§eSerwer śpi - dołącz, aby go obudzić"
	bedrockMsgStarting = "§eSerwer się uruchamia - dołącz za minutę"
	bedrockMsgFull     = "§cBrak miejsc na darmowe serwery - spróbuj za chwilę"
	bedrockMsgOffline  = "§cSerwer jest wyłączony"
)

// The protocol and version the pong reports. The list doesn't compare them
// with the game's, and the real server answers with its own once it's up.
const (
	bedrockPongProtocol       = "924"
	bedrockPongProtocolNumber = 924
	bedrockPongVersion        = "1.26"
)

// How long a started server keeps its port to itself before the waker may
// take it back (if the server didn't come up, it's stopped again by then).
const udpStartHold = 2 * time.Minute

type udpWaker struct {
	wake func(ctx context.Context, id string) error
	guid uint64

	mu    sync.Mutex
	socks map[string]*udpSock  // server id -> the port the waker holds for it
	hold  map[string]time.Time // server id -> not before; set when the server starts
}

type udpSock struct {
	port   int
	reason string // why the server is down (stopReason), or "waking"
	conn   net.PacketConn
	tcp    net.Listener // NetherNet's HTTP part on the same port, nil if taken
	mu     sync.Mutex
}

func (s *udpSock) close() {
	_ = s.conn.Close()
	if s.tcp != nil {
		_ = s.tcp.Close()
	}
}

func newUDPWaker(wake func(ctx context.Context, id string) error) *udpWaker {
	return &udpWaker{wake: wake, guid: rand.Uint64(), socks: map[string]*udpSock{}, hold: map[string]time.Time{}}
}

// release gives a server's port back before the server starts.
func (u *udpWaker) release(id string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.hold[id] = time.Now().Add(udpStartHold)
	if s := u.socks[id]; s != nil {
		s.close()
		delete(u.socks, id)
	}
}

// sync makes the waker hold exactly the ports in down (server id -> its port
// and why it's down).
func (u *udpWaker) sync(down map[string]udpTarget) {
	u.mu.Lock()
	defer u.mu.Unlock()
	for id, s := range u.socks {
		if t, ok := down[id]; !ok || t.port != s.port {
			s.close()
			delete(u.socks, id)
		}
	}
	now := time.Now()
	for id, until := range u.hold {
		if now.After(until) {
			delete(u.hold, id)
		}
	}
	for id, t := range down {
		if _, held := u.hold[id]; held {
			continue
		}
		if s := u.socks[id]; s != nil {
			s.mu.Lock()
			if s.reason != "waking" || t.reason != "sleeping" {
				s.reason = t.reason
			}
			s.mu.Unlock()
			continue
		}
		conn, err := net.ListenPacket("udp", ":"+strconv.Itoa(t.port))
		if err != nil {
			log.Printf("bedrock waker: port %d for %s: %v", t.port, id, err)
			continue
		}
		s := &udpSock{port: t.port, reason: t.reason, conn: conn}
		if ln, err := net.Listen("tcp", ":"+strconv.Itoa(t.port)); err != nil {
			log.Printf("bedrock waker: TCP port %d for %s: %v", t.port, id, err)
		} else {
			s.tcp = ln
			go u.serveNetherNet(id, t.name, s)
		}
		u.socks[id] = s
		go u.serve(id, t.name, s)
	}
}

type udpTarget struct {
	port   int
	reason string
	name   string // shown as the server's name in the list
}

func (u *udpWaker) serve(id, name string, s *udpSock) {
	buf := make([]byte, 2048)
	for {
		n, from, err := s.conn.ReadFrom(buf)
		if err != nil {
			return // closed
		}
		pkt := buf[:n]
		if len(pkt) == 0 {
			continue
		}
		s.mu.Lock()
		reason := s.reason
		s.mu.Unlock()
		switch pkt[0] {
		case rakUnconnectedPing, rakUnconnectedPingOpen:
			if len(pkt) < 25 || !bytes.Equal(pkt[9:25], rakMagic) {
				continue
			}
			pong := bedrockPong(pkt[1:9], u.guid, name, bedrockMessage(reason), s.port)
			_, _ = s.conn.WriteTo(pong, from)
		case rakOpenConnRequest1:
			// Someone is joining. The game gives up after a while; by the time
			// the player tries again the server is up.
			if len(pkt) < 17 || !bytes.Equal(pkt[1:17], rakMagic) || reason != "sleeping" {
				continue
			}
			s.mu.Lock()
			s.reason = "waking"
			s.mu.Unlock()
			go u.wakeServer(id, from, s)
		}
	}
}

// serveNetherNet answers games that connect over NetherNet, which ask over
// HTTP first: GET /v1/join is the server list's question (name, players), and
// POST /v1/join/<id> is someone joining, which wakes a sleeping server. The
// join is refused, as RakNet's is; by the time the player tries again the
// server is up.
func (u *udpWaker) serveNetherNet(id, name string, s *udpSock) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/join", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		reason := s.reason
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"name": bedrockMessage(reason), "protocol": bedrockPongProtocolNumber, "version": bedrockPongVersion,
			"level": name, "players": 0, "maxPlayers": 0, "gameType": 0,
		})
	})
	mux.HandleFunc("POST /v1/join/{network}", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		sleeping := s.reason == "sleeping"
		if sleeping {
			s.reason = "waking"
		}
		s.mu.Unlock()
		if sleeping {
			from, _ := net.ResolveTCPAddr("tcp", r.RemoteAddr)
			go u.wakeServer(id, from, s)
		}
		http.Error(w, bedrockMessage("waking"), http.StatusServiceUnavailable)
	})
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second}
	_ = srv.Serve(s.tcp) // until the port is let go
}

func (u *udpWaker) wakeServer(id string, from net.Addr, s *udpSock) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	err := u.wake(ctx, id)
	switch {
	case errors.Is(err, errFull):
		log.Printf("bedrock waker: no room to wake %s", id)
		s.mu.Lock()
		s.reason = "full"
		s.mu.Unlock()
	case err != nil:
		log.Printf("bedrock waker: wake %s: %v", id, err)
		s.mu.Lock()
		s.reason = "sleeping"
		s.mu.Unlock()
	default:
		log.Printf("bedrock waker: woke %s for %s", id, from)
	}
}

func bedrockMessage(reason string) string {
	switch reason {
	case "sleeping":
		return bedrockMsgSleeping
	case "waking":
		return bedrockMsgStarting
	case "full":
		return bedrockMsgFull
	default:
		return bedrockMsgOffline
	}
}

// bedrockPong is the reply to a server-list ping: the ping's time, our ID and
// the server's description, which the game shows in its list.
func bedrockPong(pingTime []byte, guid uint64, name, motd string, port int) []byte {
	clean := func(s string) string { return strings.ReplaceAll(s, ";", ",") }
	info := fmt.Sprintf("MCPE;%s;%s;%s;0;0;%d;%s;Survival;1;%d;%d;",
		clean(motd), bedrockPongProtocol, bedrockPongVersion, guid, clean(name), port, port)
	b := []byte{rakUnconnectedPong}
	b = append(b, pingTime...)
	b = binary.BigEndian.AppendUint64(b, guid)
	b = append(b, rakMagic...)
	b = binary.BigEndian.AppendUint16(b, uint16(len(info)))
	return append(b, info...)
}

// watchBedrockPorts keeps the waker's ports in line with the stopped servers.
func (a *agent) watchBedrockPorts(ctx context.Context) {
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		down, err := a.downBedrockServers(ctx)
		if err != nil {
			log.Printf("bedrock waker: %v", err)
		} else {
			a.udp.sync(down)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// downBedrockServers lists the stopped servers Bedrock players join on UDP.
func (a *agent) downBedrockServers(ctx context.Context) (map[string]udpTarget, error) {
	var list []struct {
		State  string            `json:"State"`
		Labels map[string]string `json:"Labels"`
	}
	query := url.Values{"all": {"1"}, "filters": {`{"label":["mchost.server"]}`}}
	if err := a.docker.call(ctx, http.MethodGet, "/containers/json", query, nil, &list); err != nil {
		return nil, err
	}
	down := map[string]udpTarget{}
	for _, c := range list {
		edition := c.Labels["mchost.edition"]
		if c.State == "running" || c.State == "restarting" || (edition != "BEDROCK" && edition != "JAVA") {
			continue
		}
		id := c.Labels["mchost.server"]
		info, err := a.docker.InspectContainer(ctx, containerName(id))
		if err != nil {
			continue
		}
		port := info.udpPort()
		if port == 0 {
			continue // a Java server without crossplay
		}
		name := info.Config.Labels["mchost.name"]
		if name == "" {
			name = "mchosting.pl"
		}
		down[id] = udpTarget{port: port, reason: a.stopReason(id, info), name: name}
	}
	return down, nil
}

// udpPort is the host port Bedrock players use, or 0 if the server has none.
func (c *ContainerInfo) udpPort() int {
	// A Bedrock server and Geyser both listen on Bedrock's usual port inside.
	for _, b := range c.HostConfig.PortBindings[geyserPort] {
		if port, err := strconv.Atoi(b.HostPort); err == nil {
			return port
		}
	}
	return 0
}
