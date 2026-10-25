package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"net"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func freeUDPPort(t *testing.T) int {
	t.Helper()
	c, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	return c.LocalAddr().(*net.UDPAddr).Port
}

// pingBedrock sends a server-list ping and returns the description in the pong.
func pingBedrock(t *testing.T, port int) string {
	t.Helper()
	c, err := net.Dial("udp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	ping := []byte{rakUnconnectedPing}
	ping = binary.BigEndian.AppendUint64(ping, 1234)
	ping = append(ping, rakMagic...)
	ping = binary.BigEndian.AppendUint64(ping, 42)
	if _, err := c.Write(ping); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 2048)
	n, err := c.Read(buf)
	if err != nil {
		t.Fatalf("no pong: %v", err)
	}
	pong := buf[:n]
	if pong[0] != rakUnconnectedPong || binary.BigEndian.Uint64(pong[1:9]) != 1234 || !bytes.Equal(pong[17:33], rakMagic) {
		t.Fatalf("bad pong % x", pong)
	}
	size := int(binary.BigEndian.Uint16(pong[33:35]))
	return string(pong[35 : 35+size])
}

func TestUDPWakerAnswersAndWakes(t *testing.T) {
	var woke atomic.Int32
	u := newUDPWaker(func(context.Context, string) error { woke.Add(1); return nil })
	port := freeUDPPort(t)
	u.sync(map[string]udpTarget{"s1": {port: port, reason: "sleeping", name: "Ekipa"}})
	defer u.sync(nil)

	info := pingBedrock(t, port)
	if !strings.HasPrefix(info, "MCPE;"+bedrockMsgSleeping+";") || !strings.Contains(info, ";Ekipa;") {
		t.Fatalf("pong info %q", info)
	}

	// A player joining wakes the server once; the list then says it's starting.
	c, _ := net.Dial("udp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	defer c.Close()
	req := append([]byte{rakOpenConnRequest1}, rakMagic...)
	req = append(req, 11)
	req = append(req, make([]byte, 1000)...)
	_, _ = c.Write(req)
	_, _ = c.Write(req)
	deadline := time.Now().Add(2 * time.Second)
	for woke.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if woke.Load() != 1 {
		t.Fatalf("woke %d times", woke.Load())
	}
	if info := pingBedrock(t, port); !strings.Contains(info, bedrockMsgStarting) {
		t.Fatalf("after waking: %q", info)
	}
	// The next sync still sees the container stopped; it keeps saying "starting".
	u.sync(map[string]udpTarget{"s1": {port: port, reason: "sleeping", name: "Ekipa"}})
	if info := pingBedrock(t, port); !strings.Contains(info, bedrockMsgStarting) {
		t.Fatalf("after sync: %q", info)
	}
}

func TestUDPWakerOfflineDoesNotWake(t *testing.T) {
	var woke atomic.Int32
	u := newUDPWaker(func(context.Context, string) error { woke.Add(1); return nil })
	port := freeUDPPort(t)
	u.sync(map[string]udpTarget{"s1": {port: port, reason: "stopped", name: "X"}})
	defer u.sync(nil)
	if info := pingBedrock(t, port); !strings.Contains(info, bedrockMsgOffline) {
		t.Fatalf("%q", info)
	}
	c, _ := net.Dial("udp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	defer c.Close()
	req := append([]byte{rakOpenConnRequest1}, rakMagic...)
	_, _ = c.Write(append(req, 11))
	time.Sleep(100 * time.Millisecond)
	if woke.Load() != 0 {
		t.Fatal("a server its owner turned off must not wake")
	}
}

func TestUDPWakerReleasesPortForStart(t *testing.T) {
	u := newUDPWaker(func(context.Context, string) error { return nil })
	port := freeUDPPort(t)
	down := map[string]udpTarget{"s1": {port: port, reason: "sleeping"}}
	u.sync(down)
	u.release("s1")
	// Docker can publish the port now, and the waker doesn't take it back
	// while the server starts, even if the container still looks stopped.
	c, err := net.ListenPacket("udp", ":"+strconv.Itoa(port))
	if err != nil {
		t.Fatalf("port still held: %v", err)
	}
	c.Close()
	u.sync(down)
	c, err = net.ListenPacket("udp", ":"+strconv.Itoa(port))
	if err != nil {
		t.Fatalf("waker took the port back during the start: %v", err)
	}
	c.Close()
}

func TestUDPPortFromBindings(t *testing.T) {
	var info ContainerInfo
	if info.udpPort() != 0 {
		t.Fatal("no bindings, no port")
	}
	info.HostConfig.PortBindings = map[string][]struct {
		HostPort string `json:"HostPort"`
	}{"25565/tcp": {{HostPort: "30001"}}, "19132/udp": {{HostPort: "30002"}}}
	if p := info.udpPort(); p != 30002 {
		t.Fatalf("port %d", p)
	}
}
