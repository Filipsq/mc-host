package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"
)

// A small RCON client that stays connected, so sampling a server every 30
// seconds doesn't add "Thread RCON Client started / shutting down" to its
// console each time the way a fresh rcon-cli does.

const (
	rconAuth     = 3
	rconCommand  = 2
	rconResponse = 0
	rconMaxBody  = 4096
)

type rconConn struct {
	conn net.Conn
	r    *bufio.Reader
	id   int32
}

func dialRCON(ctx context.Context, addr, password string) (*rconConn, error) {
	d := net.Dialer{Timeout: 3 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	c := &rconConn{conn: conn, r: bufio.NewReader(conn)}
	c.deadline(ctx)
	if err := c.write(rconAuth, password); err != nil {
		conn.Close()
		return nil, err
	}
	id, _, _, err := c.read()
	if err == nil && id == -1 {
		err = errors.New("rcon: wrong password")
	}
	if err != nil {
		conn.Close()
		return nil, err
	}
	return c, nil
}

func (c *rconConn) deadline(ctx context.Context) {
	dl, ok := ctx.Deadline()
	if !ok {
		dl = time.Now().Add(5 * time.Second)
	}
	c.conn.SetDeadline(dl)
}

// Run sends one command and returns the server's answer.
func (c *rconConn) Run(ctx context.Context, cmd string) (string, error) {
	c.deadline(ctx)
	if err := c.write(rconCommand, cmd); err != nil {
		return "", err
	}
	for {
		id, typ, body, err := c.read()
		if err != nil {
			return "", err
		}
		if id == c.id && typ == rconResponse {
			return body, nil
		}
	}
}

func (c *rconConn) Close() { c.conn.Close() }

func (c *rconConn) write(typ int32, body string) error {
	c.id++
	buf := make([]byte, 12, 14+len(body))
	binary.LittleEndian.PutUint32(buf[0:], uint32(10+len(body)))
	binary.LittleEndian.PutUint32(buf[4:], uint32(c.id))
	binary.LittleEndian.PutUint32(buf[8:], uint32(typ))
	buf = append(append(buf, body...), 0, 0)
	_, err := c.conn.Write(buf)
	return err
}

func (c *rconConn) read() (id, typ int32, body string, err error) {
	var head [12]byte
	if _, err = io.ReadFull(c.r, head[:]); err != nil {
		return
	}
	size := int32(binary.LittleEndian.Uint32(head[0:]))
	if size < 10 || size > rconMaxBody+10 {
		return 0, 0, "", fmt.Errorf("rcon: bad packet size %d", size)
	}
	id = int32(binary.LittleEndian.Uint32(head[4:]))
	typ = int32(binary.LittleEndian.Uint32(head[8:]))
	rest := make([]byte, size-8)
	if _, err = io.ReadFull(c.r, rest); err != nil {
		return
	}
	return id, typ, strings.TrimRight(string(rest), "\x00"), nil
}

// rconSettings reads the RCON port and password the image wrote to server.properties.
func rconSettings(props string) (port, password string) {
	port = "25575"
	for _, line := range strings.Split(props, "\n") {
		k, v, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		v = unescapeProperty(v)
		switch strings.TrimSpace(k) {
		case "rcon.port":
			if v != "" {
				port = v
			}
		case "rcon.password":
			password = v
		}
	}
	return port, password
}

// unescapeProperty undoes the escaping Java writes into .properties values ("\:", "\=", "\\").
func unescapeProperty(v string) string {
	var b strings.Builder
	for i := 0; i < len(v); i++ {
		if v[i] == '\\' && i+1 < len(v) {
			i++
		}
		b.WriteByte(v[i])
	}
	return strings.TrimSpace(b.String())
}
