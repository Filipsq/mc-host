package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// Docker is a minimal client for the Docker Engine API over its unix socket.
// We only need a handful of endpoints, so this avoids pulling in the full SDK.
type Docker struct {
	http *http.Client
}

var errNotFound = errors.New("not found")

func NewDocker(socket string) *Docker {
	return &Docker{http: &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socket)
		},
	}}}
}

func (d *Docker) do(ctx context.Context, method, path string, query url.Values, body any) (*http.Response, error) {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		r = bytes.NewReader(b)
	}
	u := "http://docker" + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, r)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := d.http.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusNotFound {
		resp.Body.Close()
		return nil, errNotFound
	}
	if resp.StatusCode >= 300 && resp.StatusCode != http.StatusNotModified {
		defer resp.Body.Close()
		msg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("docker %s %s: %d %s", method, path, resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	return resp, nil
}

// call runs a request and decodes a JSON response into out (if non-nil).
func (d *Docker) call(ctx context.Context, method, path string, query url.Values, body, out any) error {
	resp, err := d.do(ctx, method, path, query, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if out == nil {
		_, err = io.Copy(io.Discard, resp.Body)
		return err
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (d *Docker) ImageExists(ctx context.Context, image string) (bool, error) {
	err := d.call(ctx, http.MethodGet, "/images/"+image+"/json", nil, nil, nil)
	if errors.Is(err, errNotFound) {
		return false, nil
	}
	return err == nil, err
}

// PullImage pulls image:tag and waits until the pull finishes.
func (d *Docker) PullImage(ctx context.Context, image string) error {
	name, tag, _ := strings.Cut(image, ":")
	if tag == "" {
		tag = "latest"
	}
	resp, err := d.do(ctx, http.MethodPost, "/images/create", url.Values{"fromImage": {name}, "tag": {tag}}, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// The body is a stream of JSON progress messages; errors arrive in-band.
	dec := json.NewDecoder(resp.Body)
	for {
		var msg struct {
			Error string `json:"error"`
		}
		if err := dec.Decode(&msg); err == io.EOF {
			return nil
		} else if err != nil {
			return err
		}
		if msg.Error != "" {
			return fmt.Errorf("pull %s: %s", image, msg.Error)
		}
	}
}

func (d *Docker) CreateContainer(ctx context.Context, name string, spec map[string]any) error {
	return d.call(ctx, http.MethodPost, "/containers/create", url.Values{"name": {name}}, spec, nil)
}

func (d *Docker) StartContainer(ctx context.Context, name string) error {
	return d.call(ctx, http.MethodPost, "/containers/"+name+"/start", nil, nil, nil)
}

// StopContainer asks the server to shut down cleanly, giving it time to save the world.
func (d *Docker) StopContainer(ctx context.Context, name string, timeoutSec int) error {
	return d.call(ctx, http.MethodPost, "/containers/"+name+"/stop", url.Values{"t": {fmt.Sprint(timeoutSec)}}, nil, nil)
}

func (d *Docker) RemoveContainer(ctx context.Context, name string) error {
	return d.call(ctx, http.MethodDelete, "/containers/"+name, url.Values{"force": {"true"}}, nil, nil)
}

func (d *Docker) RemoveVolume(ctx context.Context, name string) error {
	return d.call(ctx, http.MethodDelete, "/volumes/"+name, url.Values{"force": {"true"}}, nil, nil)
}

type ContainerInfo struct {
	State struct {
		Status     string `json:"Status"`
		StartedAt  string `json:"StartedAt"`
		FinishedAt string `json:"FinishedAt"`
		ExitCode   int    `json:"ExitCode"`
		Health     *struct {
			Status string `json:"Status"`
		} `json:"Health"`
	} `json:"State"`
	Config struct {
		Tty    bool              `json:"Tty"`
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	RestartCount    int `json:"RestartCount"`
	NetworkSettings struct {
		Networks map[string]struct {
			IPAddress string `json:"IPAddress"`
		} `json:"Networks"`
	} `json:"NetworkSettings"`
}

// IP returns the container's address on its Docker network, if it has one.
func (c *ContainerInfo) IP() string {
	for _, n := range c.NetworkSettings.Networks {
		if n.IPAddress != "" {
			return n.IPAddress
		}
	}
	return ""
}

func (d *Docker) InspectContainer(ctx context.Context, name string) (*ContainerInfo, error) {
	var info ContainerInfo
	if err := d.call(ctx, http.MethodGet, "/containers/"+name+"/json", nil, nil, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

type LogOptions struct {
	Tail       int   // last N lines; 0 = all
	Follow     bool  // keep streaming new lines
	Since      int64 // unix seconds; 0 = from the start
	Timestamps bool  // prefix each line with an RFC 3339 timestamp
}

// Logs streams container output line by line to fn until ctx ends or (without Follow) the log is read.
func (d *Docker) Logs(ctx context.Context, name string, opts LogOptions, fn func(line string) error) error {
	info, err := d.InspectContainer(ctx, name)
	if err != nil {
		return err
	}
	q := url.Values{"stdout": {"1"}, "stderr": {"1"}, "tail": {"all"}}
	if opts.Tail > 0 {
		q.Set("tail", fmt.Sprint(opts.Tail))
	}
	if opts.Follow {
		q.Set("follow", "1")
	}
	if opts.Since > 0 {
		q.Set("since", fmt.Sprint(opts.Since))
	}
	if opts.Timestamps {
		q.Set("timestamps", "1")
	}
	resp, err := d.do(ctx, http.MethodGet, "/containers/"+name+"/logs", q, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var r io.Reader = resp.Body
	if !info.Config.Tty {
		// Without a TTY Docker multiplexes stdout/stderr with 8-byte frame headers.
		pr, pw := io.Pipe()
		go func() { pw.CloseWithError(demux(resp.Body, pw)) }()
		r = pr
	}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		if err := fn(strings.TrimRight(sc.Text(), "\r")); err != nil {
			return err
		}
	}
	if ctx.Err() != nil {
		return nil
	}
	return sc.Err()
}

// Exec runs cmd inside the container and returns its combined output.
func (d *Docker) Exec(ctx context.Context, name string, cmd []string) (string, error) {
	var created struct {
		ID string `json:"Id"`
	}
	err := d.call(ctx, http.MethodPost, "/containers/"+name+"/exec", nil, map[string]any{
		"Cmd": cmd, "AttachStdout": true, "AttachStderr": true,
	}, &created)
	if err != nil {
		return "", err
	}
	resp, err := d.do(ctx, http.MethodPost, "/exec/"+created.ID+"/start", nil, map[string]any{"Detach": false, "Tty": false})
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out bytes.Buffer
	if err := demux(resp.Body, &out); err != nil {
		return "", err
	}
	return out.String(), nil
}

// demux strips Docker's stream framing: [type, 0, 0, 0, size(4 bytes BE)] + payload.
func demux(r io.Reader, w io.Writer) error {
	header := make([]byte, 8)
	for {
		if _, err := io.ReadFull(r, header); err == io.EOF {
			return nil
		} else if err != nil {
			return err
		}
		size := int64(binary.BigEndian.Uint32(header[4:]))
		if _, err := io.CopyN(w, r, size); err != nil {
			return err
		}
	}
}
