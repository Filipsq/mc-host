package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// Valheim servers run lloesche/valheim-server, which installs the game with
// steamcmd, keeps it up to date and restarts it when an update comes out while
// nobody is playing. The image wants its settings and worlds in /config and
// the game in /opt/valheim; both are the server's volume (as /data is), so
// the worlds sit in worlds_local/, adminlist.txt at the top, and the game in
// server/ (it counts toward the disk limit, about 1 GB). Players connect
// straight to the server's port over UDP with the game's "Join IP"; Steam's
// query port (2457) stays inside, where the agent asks it how many play.

const (
	valheimImage        = "lloesche/valheim-server:latest"
	valheimPort         = "2456/udp"
	valheimQuery        = 2457
	valheimMaxPlayer    = 10 // Valheim's own limit
	defaultValheimWorld = "Dedicated"
)

// valheimSupported reports whether this machine can run Valheim: its server is x86 only.
func valheimSupported() bool { return runtime.GOARCH == "amd64" }

var (
	valheimPresets  = map[string]bool{"normal": true, "casual": true, "easy": true, "hard": true, "hardcore": true, "immersive": true, "hammer": true}
	validValheimPwd = regexp.MustCompile(`^[A-Za-z0-9]{5,20}$`)
	// Valheim's world names: letters, digits, "_" and "-".
	validValheimWorld = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)
)

func (req *createRequest) validateValheim() error {
	if req.Difficulty == "" {
		req.Difficulty = "normal"
	}
	switch {
	case !validID.MatchString(req.ID):
		return errors.New("invalid id")
	case req.MemoryMb < 512 || req.Port < 1024 || req.Port > 65535 || req.CPUs <= 0 || req.DiskMb < 0:
		return errors.New("invalid memoryMb, cpus, port or diskMb")
	case !valheimSupported():
		return errors.New("Valheim servers need an x86 (amd64) machine")
	case !valheimPresets[req.Difficulty]:
		return errors.New("a Valheim world's difficulty must be one of the game's presets")
	case !validValheimPwd.MatchString(req.Password):
		return errors.New("Valheim needs a password of 5 to 20 letters or digits")
	case strings.Contains(strings.ToLower(req.Name), strings.ToLower(req.Password)):
		return errors.New("Valheim doesn't take a password that is part of the server's name")
	case req.Level != "" && !validValheimWorld.MatchString(req.Level):
		return errors.New("invalid level")
	case len(req.Plugins) > 0 || req.Kind != "" && req.Kind != "vanilla":
		return errors.New("Valheim servers take no plugins or mods")
	case req.Whitelist || req.Crossplay || req.offline() || req.Modpack != "" || req.Hostname != "" || req.VoiceHost != "":
		return errors.New("whitelist, crossplay, onlineMode, modpacks, hostnames and voice are Minecraft only")
	}
	req.Kind, req.Version, req.Seed, req.LevelType = "vanilla", "LATEST", "", ""
	return nil
}

// valheimName is the name shown in Valheim; the game takes printable characters.
func valheimName(name string) string {
	name = strings.Map(func(r rune) rune {
		if r < ' ' || r == '"' {
			return -1
		}
		return r
	}, name)
	if name == "" {
		return "MCHosting"
	}
	return name
}

// valheimSpec is the environment of a Valheim server's container.
func valheimSpec(req createRequest) []string {
	return []string{
		"SERVER_NAME=" + valheimName(req.Name),
		"SERVER_PORT=2456",
		"WORLD_NAME=" + req.level(),
		"SERVER_PASS=" + req.Password,
		"SERVER_PUBLIC=false", // players join by address; not listed in the game's server browser
		"SERVER_ARGS=-preset " + req.Difficulty,
		"BACKUPS=false",     // the plan's backups cover the worlds
		"STATUS_HTTP=false", // no web pages inside the container
		"SUPERVISOR_HTTP=false",
		"TZ=Europe/Warsaw", // the image restarts for updates at night, Polish time
	}
}

// valheimMounts puts the image's two folders on the server's volume, next to /data.
func valheimMounts(id string) []map[string]any {
	return []map[string]any{
		{"Type": "volume", "Source": containerName(id), "Target": "/data"},
		{"Type": "volume", "Source": containerName(id), "Target": "/config"},
		{"Type": "volume", "Source": containerName(id), "Target": "/opt/valheim"},
	}
}

// valheimPlayers asks the server's Steam query port how many players are on
// (Valve's A2S_INFO). Valheim lists no names there.
func (a *agent) valheimPlayers(ctx context.Context, ip string) (count, max int, err error) {
	if ip == "" {
		return 0, 0, errors.New("no address")
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return a2sInfo(ctx, net.JoinHostPort(ip, fmt.Sprint(valheimQuery)))
}

// a2sInfo sends Valve's A2S_INFO query, answering the challenge Steam servers
// ask for since 2020, and reads the players and the most allowed.
func a2sInfo(ctx context.Context, addr string) (players, max int, err error) {
	var d net.Dialer
	conn, err := d.DialContext(ctx, "udp", addr)
	if err != nil {
		return 0, 0, err
	}
	defer conn.Close()
	if dl, ok := ctx.Deadline(); ok {
		conn.SetDeadline(dl)
	}
	query := append([]byte{0xFF, 0xFF, 0xFF, 0xFF, 'T'}, []byte("Source Engine Query\x00")...)
	buf := make([]byte, 1400)
	for try := 0; try < 2; try++ {
		if _, err := conn.Write(query); err != nil {
			return 0, 0, err
		}
		n, err := conn.Read(buf)
		if err != nil {
			return 0, 0, err
		}
		resp := buf[:n]
		if len(resp) < 5 || !bytes.Equal(resp[:4], []byte{0xFF, 0xFF, 0xFF, 0xFF}) {
			return 0, 0, errors.New("not an A2S answer")
		}
		switch resp[4] {
		case 'A': // a challenge: ask again with it
			if len(resp) < 9 {
				return 0, 0, errors.New("short challenge")
			}
			query = append(query[:25:25], resp[5:9]...)
			continue
		case 'I':
			return parseA2SInfo(resp[5:])
		default:
			return 0, 0, fmt.Errorf("unexpected A2S answer %#x", resp[4])
		}
	}
	return 0, 0, errors.New("no A2S answer after the challenge")
}

// parseA2SInfo reads the player counts from an A2S_INFO answer, after its header.
func parseA2SInfo(b []byte) (players, max int, err error) {
	if len(b) < 1 {
		return 0, 0, errors.New("short A2S answer")
	}
	b = b[1:]                // protocol
	for i := 0; i < 4; i++ { // name, map, folder, game
		end := bytes.IndexByte(b, 0)
		if end < 0 {
			return 0, 0, errors.New("short A2S answer")
		}
		b = b[end+1:]
	}
	if len(b) < 4 {
		return 0, 0, errors.New("short A2S answer")
	}
	_ = binary.LittleEndian.Uint16(b) // the game's Steam ID
	return int(b[2]), int(b[3]), nil
}
