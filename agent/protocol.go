package main

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// Just enough of the Minecraft Java protocol to read the handshake (which
// carries the hostname the player typed) and to answer for a server that
// isn't running: the server-list status and a login "disconnect" message.

const maxPacket = 4096

type handshake struct {
	Protocol  int32
	Host      string
	Port      uint16
	NextState int32 // 1 = status (server list ping), 2 = login, 3 = transfer
}

var errLegacyPing = errors.New("legacy ping")

func readVarInt(r io.ByteReader) (int32, error) {
	var value uint32
	for i := 0; i < 5; i++ {
		b, err := r.ReadByte()
		if err != nil {
			return 0, err
		}
		value |= uint32(b&0x7f) << (7 * i)
		if b&0x80 == 0 {
			return int32(value), nil
		}
	}
	return 0, errors.New("varint too long")
}

func appendVarInt(buf []byte, v int32) []byte {
	u := uint32(v)
	for {
		if u&^0x7f == 0 {
			return append(buf, byte(u))
		}
		buf = append(buf, byte(u&0x7f|0x80))
		u >>= 7
	}
}

func appendString(buf []byte, s string) []byte {
	buf = appendVarInt(buf, int32(len(s)))
	return append(buf, s...)
}

// readPacket returns one length-prefixed packet's body, and the raw bytes as read.
func readPacket(r *bufio.Reader) (body, raw []byte, err error) {
	length, err := readVarInt(r)
	if err != nil {
		return nil, nil, err
	}
	if length <= 0 || length > maxPacket {
		return nil, nil, fmt.Errorf("bad packet length %d", length)
	}
	body = make([]byte, length)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, nil, err
	}
	return body, append(appendVarInt(nil, length), body...), nil
}

// readHandshake reads the first packet of a connection. raw is replayed to the backend.
func readHandshake(r *bufio.Reader) (hs handshake, raw []byte, err error) {
	if first, err := r.Peek(1); err == nil && first[0] == 0xFE {
		return hs, nil, errLegacyPing // pre-1.7 clients; not supported
	}
	body, raw, err := readPacket(r)
	if err != nil {
		return hs, nil, err
	}
	br := bytes.NewReader(body)
	id, err := readVarInt(br)
	if err != nil || id != 0 {
		return hs, nil, errors.New("not a handshake")
	}
	if hs.Protocol, err = readVarInt(br); err != nil {
		return hs, nil, err
	}
	hostLen, err := readVarInt(br)
	if err != nil || hostLen < 0 || int(hostLen) > br.Len() {
		return hs, nil, errors.New("bad host length")
	}
	host := make([]byte, hostLen)
	_, _ = br.Read(host)
	hs.Host = string(host)
	if err := binary.Read(br, binary.BigEndian, &hs.Port); err != nil {
		return hs, nil, err
	}
	if hs.NextState, err = readVarInt(br); err != nil {
		return hs, nil, err
	}
	return hs, raw, nil
}

// normalizeHost strips what clients append to the address: Forge/FML markers
// after a NUL byte, a trailing dot, and letter case.
func normalizeHost(h string) string {
	h, _, _ = strings.Cut(h, "\x00")
	return strings.ToLower(strings.TrimSuffix(h, "."))
}

func writePacket(w io.Writer, id int32, payload []byte) error {
	body := append(appendVarInt(nil, id), payload...)
	_, err := w.Write(append(appendVarInt(nil, int32(len(body))), body...))
	return err
}

// statusJSON is the server-list entry shown for a server we answer ourselves.
// Echoing the client's protocol version avoids the "incompatible version" warning.
func statusJSON(protocol int32, label, motd string) string {
	b, _ := json.Marshal(map[string]any{
		"version":     map[string]any{"name": label, "protocol": protocol},
		"players":     map[string]int{"max": 0, "online": 0},
		"description": map[string]string{"text": motd},
	})
	return string(b)
}

func chatJSON(text string) string {
	b, _ := json.Marshal(map[string]string{"text": text})
	return string(b)
}
