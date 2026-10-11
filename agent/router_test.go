package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func handshakePacket(host string, nextState int32) []byte {
	body := appendVarInt(nil, 0x00)
	body = appendVarInt(body, 767) // protocol version
	body = appendString(body, host)
	body = binary.BigEndian.AppendUint16(body, 25565)
	body = appendVarInt(body, nextState)
	return append(appendVarInt(nil, int32(len(body))), body...)
}

func TestReadHandshake(t *testing.T) {
	r := bufio.NewReader(bytes.NewReader(handshakePacket("Ekipa.MCHost.pl.\x00FML3\x00", 2)))
	hs, raw, err := readHandshake(r)
	if err != nil {
		t.Fatal(err)
	}
	if hs.Protocol != 767 || hs.NextState != 2 || normalizeHost(hs.Host) != "ekipa.mchost.pl" {
		t.Fatalf("%+v host=%q", hs, normalizeHost(hs.Host))
	}
	if !bytes.Equal(raw, handshakePacket("Ekipa.MCHost.pl.\x00FML3\x00", 2)) {
		t.Fatal("raw bytes should match what was read, to replay to the backend")
	}
}

// startRouter runs a router on a random port with a fixed lookup table.
func startRouter(t *testing.T, targets map[string]*routeTarget, woke *atomic.Int32) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	rt := &router{
		lookup: func(_ context.Context, host string) (*routeTarget, error) { return targets[host], nil },
		wake:   func(context.Context, string) error { woke.Add(1); return nil },
		dial:   dialTCP,
	}
	go rt.serve(ln)
	return ln.Addr().String()
}

// ping does a server-list ping and returns the status JSON.
func ping(t *testing.T, addr, host string) map[string]any {
	t.Helper()
	conn, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	conn.Write(handshakePacket(host, 1))
	writePacket(conn, 0x00, nil) // status request
	r := bufio.NewReader(conn)
	body, _, err := readPacket(r)
	if err != nil {
		t.Fatal(err)
	}
	br := bytes.NewReader(body[1:])
	n, _ := readVarInt(br)
	js := make([]byte, n)
	io.ReadFull(br, js)
	var status map[string]any
	if err := json.Unmarshal(js, &status); err != nil {
		t.Fatal(err)
	}
	// Ping/pong round trip.
	writePacket(conn, 0x01, []byte{1, 2, 3, 4, 5, 6, 7, 8})
	pong, _, err := readPacket(r)
	if err != nil || !bytes.Equal(pong, []byte{0x01, 1, 2, 3, 4, 5, 6, 7, 8}) {
		t.Fatalf("pong = %v, %v", pong, err)
	}
	return status
}

// join attempts a login and returns the disconnect message.
func join(t *testing.T, addr, host string) string {
	t.Helper()
	conn, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	conn.Write(handshakePacket(host, 2))
	writePacket(conn, 0x00, appendString(nil, "Steve")) // login start (simplified)
	body, _, err := readPacket(bufio.NewReader(conn))
	if err != nil {
		t.Fatal(err)
	}
	br := bytes.NewReader(body[1:])
	n, _ := readVarInt(br)
	msg := make([]byte, n)
	io.ReadFull(br, msg)
	return string(msg)
}

func TestRouterSleepingServer(t *testing.T) {
	var woke atomic.Int32
	addr := startRouter(t, map[string]*routeTarget{"ekipa.mchost.pl": {ID: "s1", Reason: "sleeping"}}, &woke)

	status := ping(t, addr, "ekipa.mchost.pl")
	if !strings.Contains(status["description"].(map[string]any)["text"].(string), "śpi") {
		t.Fatalf("status = %v", status)
	}
	if status["version"].(map[string]any)["protocol"].(float64) != 767 {
		t.Fatal("should echo the client's protocol version")
	}
	if woke.Load() != 0 {
		t.Fatal("a server-list ping must not wake the server")
	}
	if msg := join(t, addr, "ekipa.mchost.pl"); !strings.Contains(msg, "uruchamia") {
		t.Fatalf("join message = %s", msg)
	}
	if woke.Load() != 1 {
		t.Fatal("joining should wake the server")
	}
}

func TestRouterStoppedAndUnknown(t *testing.T) {
	var woke atomic.Int32
	addr := startRouter(t, map[string]*routeTarget{"off.mchost.pl": {ID: "s2", Reason: "stopped"}}, &woke)
	if msg := join(t, addr, "off.mchost.pl"); !strings.Contains(msg, "wyłączony") {
		t.Fatalf("join message = %s", msg)
	}
	if woke.Load() != 0 {
		t.Fatal("a server stopped by its owner must not be woken by players")
	}
	if msg := join(t, addr, "nope.mchost.pl"); !strings.Contains(msg, "Nie ma takiego serwera") {
		t.Fatalf("unknown host message = %s", msg)
	}
}

func TestRouterProxiesToRunningServer(t *testing.T) {
	backend, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer backend.Close()
	got := make(chan []byte, 1)
	go func() {
		c, err := backend.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		r := bufio.NewReader(c)
		_, raw, _ := readHandshake(r)
		c.Write([]byte("hello from backend"))
		got <- raw
	}()

	var woke atomic.Int32
	addr := startRouter(t, map[string]*routeTarget{"live.mchost.pl": {ID: "s3", Running: true, Addr: backend.Addr().String()}}, &woke)
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	conn.Write(handshakePacket("live.mchost.pl", 2))
	reply := make([]byte, len("hello from backend"))
	if _, err := io.ReadFull(conn, reply); err != nil || string(reply) != "hello from backend" {
		t.Fatalf("reply = %q, %v", reply, err)
	}
	if raw := <-got; !bytes.Equal(raw, handshakePacket("live.mchost.pl", 2)) {
		t.Fatal("backend should receive the original handshake")
	}
}

func TestRouterStartingServer(t *testing.T) {
	// Running container, but nothing listening yet: players see "starting".
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := ln.Addr().String()
	ln.Close()
	var woke atomic.Int32
	router := startRouter(t, map[string]*routeTarget{"boot.mchost.pl": {ID: "s4", Running: true, Addr: addr}}, &woke)
	if msg := join(t, router, "boot.mchost.pl"); !strings.Contains(msg, "uruchamia") {
		t.Fatalf("join message = %s", msg)
	}
}
