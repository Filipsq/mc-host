package main

import (
	"bufio"
	"context"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
)

// The site picks a new server's port as the lowest one no server in its
// database has. Something on the machine can still hold a port the database
// thinks is free: a container left behind, a stopped container still bound to
// a port its server has since moved off, the Bedrock waker standing in for a
// sleeping server on an old port. Docker then refuses the new container
// ("address already in use"). GET /ports lists every port the machine holds
// or has promised, so the site skips them.

// usedPorts is every port a socket on the machine listens on (TCP) or is bound
// to (UDP), and every host port a container, running or not, publishes.
func (a *agent) usedPorts(ctx context.Context) []int {
	used := map[int]bool{}
	for _, f := range []string{"tcp", "tcp6", "udp", "udp6"} {
		for _, p := range socketPorts("/proc/net/"+f, strings.HasPrefix(f, "tcp")) {
			used[p] = true
		}
	}
	if a.docker != nil {
		var list []struct {
			ID string `json:"Id"`
		}
		if err := a.docker.call(ctx, http.MethodGet, "/containers/json", url.Values{"all": {"1"}}, nil, &list); err == nil {
			for _, c := range list {
				info, err := a.docker.InspectContainer(ctx, c.ID)
				if err != nil {
					continue
				}
				for _, binds := range info.HostConfig.PortBindings {
					for _, b := range binds {
						if p, err := strconv.Atoi(b.HostPort); err == nil {
							used[p] = true
						}
					}
				}
			}
		}
	}
	out := make([]int, 0, len(used))
	for p := range used {
		out = append(out, p)
	}
	slices.Sort(out)
	return out
}

// socketPorts reads the local ports in a /proc/net/{tcp,udp}[6] table: for TCP
// only listening sockets (state 0A), for UDP every bound one.
func socketPorts(path string, tcp bool) []int {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []int
	sc := bufio.NewScanner(f)
	sc.Scan() // header
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 4 || (tcp && fields[3] != "0A") {
			continue
		}
		i := strings.LastIndexByte(fields[1], ':')
		if i < 0 {
			continue
		}
		if p, err := strconv.ParseInt(fields[1][i+1:], 16, 32); err == nil && p > 0 {
			out = append(out, int(p))
		}
	}
	return out
}

func (a *agent) ports(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ports": a.usedPorts(r.Context())})
}
