package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"time"
)

// The router owns the public Java port (25565). It reads the hostname from
// each player's handshake, finds the server with that address, and either
// proxies the connection to it or, if the server is asleep, answers on its
// behalf and wakes it up when someone tries to join.

var validHost = regexp.MustCompile(`^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$`)

type routeTarget struct {
	ID      string
	Port    int
	Running bool
	Reason  string // why it isn't running: sleeping, stopped, crashed
}

type router struct {
	lookup func(ctx context.Context, host string) (*routeTarget, error)
	wake   func(ctx context.Context, id string) error
	dial   func(port int) (net.Conn, error)
}

// Shown to players in the server list and when they're turned away.
// Polish first (our main audience), English second.
const (
	msgSleeping    = "§eSerwer śpi – dołącz, aby go obudzić\n§7Server is asleep – join to wake it up"
	msgWaking      = "Serwer się uruchamia. Dołącz ponownie za około minutę.\nThe server is starting. Join again in about a minute."
	msgStarting    = "§eSerwer się uruchamia...\n§7Server is starting..."
	msgOffline     = "§cSerwer jest wyłączony\n§7Server is offline"
	msgOfflineKick = "Serwer jest wyłączony przez właściciela.\nThe server has been turned off by its owner."
	msgUnknown     = "§cNie ma takiego serwera\n§7No server at this address"
)

func (rt *router) serve(ln net.Listener) error {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return err
		}
		go rt.handle(conn)
	}
}

func (rt *router) handle(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	r := bufio.NewReader(conn)
	hs, raw, err := readHandshake(r)
	if err != nil {
		if !errors.Is(err, io.EOF) && !errors.Is(err, errLegacyPing) {
			log.Printf("router: %s: %v", conn.RemoteAddr(), err)
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	host := normalizeHost(hs.Host)
	target, err := rt.lookup(ctx, host)
	if err != nil {
		log.Printf("router: lookup %q: %v", host, err)
		rt.answer(conn, r, hs, "", msgUnknown, msgUnknown)
		return
	}
	if target == nil {
		rt.answer(conn, r, hs, "", msgUnknown, msgUnknown)
		return
	}

	switch {
	case target.Running:
		backend, err := rt.dial(target.Port)
		if err != nil {
			// The container is up but Minecraft isn't listening yet.
			rt.answer(conn, r, hs, "Starting", msgStarting, msgWaking)
			return
		}
		defer backend.Close()
		_ = conn.SetReadDeadline(time.Time{})
		if _, err := backend.Write(raw); err != nil {
			return
		}
		pipe(conn, r, backend)
	case target.Reason == "sleeping":
		if hs.NextState != 1 {
			if err := rt.wake(ctx, target.ID); err != nil {
				log.Printf("router: wake %s: %v", target.ID, err)
			} else {
				log.Printf("router: woke %s for %s", target.ID, conn.RemoteAddr())
			}
			rt.answer(conn, r, hs, "", "", msgWaking)
			return
		}
		rt.answer(conn, r, hs, "Sleeping", msgSleeping, "")
	default:
		rt.answer(conn, r, hs, "Offline", msgOffline, msgOfflineKick)
	}
}

// answer replies as the server would: a server-list status for pings, or a
// disconnect screen for players trying to join.
func (rt *router) answer(conn net.Conn, r *bufio.Reader, hs handshake, label, motd, kick string) {
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	if hs.NextState == 1 {
		if _, _, err := readPacket(r); err != nil { // status request
			return
		}
		if err := writePacket(conn, 0x00, appendString(nil, statusJSON(hs.Protocol, label, motd))); err != nil {
			return
		}
		body, _, err := readPacket(r) // ping: id 0x01 + 8-byte payload, echoed back as pong
		if err != nil || len(body) < 9 {
			return
		}
		_ = writePacket(conn, 0x01, body[1:9])
		return
	}
	_, _, _ = readPacket(r) // login start; we only need to reply
	_ = writePacket(conn, 0x00, appendString(nil, chatJSON(kick)))
}

func pipe(client net.Conn, clientReader io.Reader, backend net.Conn) {
	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(backend, clientReader) // includes anything already buffered
		if tcp, ok := backend.(*net.TCPConn); ok {
			_ = tcp.CloseWrite()
		}
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(client, backend)
		if tcp, ok := client.(*net.TCPConn); ok {
			_ = tcp.CloseWrite()
		}
		done <- struct{}{}
	}()
	<-done
	<-done
}

// lookupByHost finds the Java server whose address label matches host.
func (a *agent) lookupByHost(ctx context.Context, host string) (*routeTarget, error) {
	if !validHost.MatchString(host) {
		return nil, nil
	}
	filters := fmt.Sprintf(`{"label":["mchost.host=%s"]}`, host)
	var list []struct {
		ID     string            `json:"Id"`
		Labels map[string]string `json:"Labels"`
	}
	if err := a.docker.call(ctx, http.MethodGet, "/containers/json", url.Values{"all": {"1"}, "filters": {filters}}, nil, &list); err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	id := list[0].Labels["mchost.server"]
	info, err := a.docker.InspectContainer(ctx, containerName(id))
	if err != nil {
		return nil, err
	}
	t := &routeTarget{ID: id, Running: info.State.Status == "running"}
	_, _ = fmt.Sscan(list[0].Labels["mchost.port"], &t.Port)
	if !t.Running {
		t.Reason = a.stopReason(id, info)
	}
	return t, nil
}

func dialLocal(port int) (net.Conn, error) {
	return net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 3*time.Second)
}
