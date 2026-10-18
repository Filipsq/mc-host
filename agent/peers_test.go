package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestRouterPassesOtherMachinesServersOn(t *testing.T) {
	// The other machine's router knows the server and says it's asleep; the main one only knows where it is.
	var woke atomic.Int32
	peer := startRouter(t, map[string]*routeTarget{"far.mchost.pl": {ID: "s9", Reason: "sleeping"}}, &woke)
	main := startRouter(t, map[string]*routeTarget{"far.mchost.pl": {Peer: peer}}, &woke)
	status := ping(t, main, "far.mchost.pl")
	if desc, _ := status["description"].(map[string]any); !strings.Contains(desc["text"].(string), "śpi") {
		t.Fatalf("status through the main router = %v", status)
	}
	join(t, main, "far.mchost.pl")
	if woke.Load() != 1 {
		t.Fatal("joining through the main router should wake the server on the other machine")
	}
}

func TestRouterOtherMachineDown(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	gone := ln.Addr().String()
	ln.Close()
	var woke atomic.Int32
	main := startRouter(t, map[string]*routeTarget{"far.mchost.pl": {Peer: gone}}, &woke)
	if msg := join(t, main, "far.mchost.pl"); !strings.Contains(msg, "niedostępna") {
		t.Fatalf("join message = %s", msg)
	}
}

func TestPutPeerRoutes(t *testing.T) {
	a := &agent{stateDir: t.TempDir()}
	put := func(body string) int {
		rec := httptest.NewRecorder()
		a.putPeerRoutes(rec, httptest.NewRequest(http.MethodPut, "/peer-routes", strings.NewReader(body)))
		return rec.Code
	}
	if code := put(`{"routes":{"Far.MCHost.pl":"10.0.0.3:25565"}}`); code != http.StatusOK {
		t.Fatalf("code = %d", code)
	}
	if code := put(`{"routes":{"bad host":"10.0.0.3:25565"}}`); code != http.StatusBadRequest {
		t.Fatalf("bad host code = %d", code)
	}
	if code := put(`{"routes":{"x.mchost.pl":"no-port"}}`); code != http.StatusBadRequest {
		t.Fatalf("bad address code = %d", code)
	}
	// A rejected list leaves the old one; a restarted agent reads it back.
	b := &agent{stateDir: a.stateDir}
	b.loadPeerRoutes()
	if b.peerRoutes["far.mchost.pl"] != "10.0.0.3:25565" || len(b.peerRoutes) != 1 {
		t.Fatalf("routes after restart = %v", b.peerRoutes)
	}
}
