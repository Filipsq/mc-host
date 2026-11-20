package main

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestSocketPorts(t *testing.T) {
	dir := t.TempDir()
	tcp := filepath.Join(dir, "tcp")
	os.WriteFile(tcp, []byte(`  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:6DDD 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1 0000000000000000 100 0 0 10 0
   1: 0100007F:7557 0100007F:6DDD 01 00000000:00000000 00:00000000 00000000     0        0 2 1 0000000000000000 20 4 30 10 -1
   2: 0100007F:7558 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 3 1 0000000000000000 100 0 0 10 0
`), 0o644)
	if got := socketPorts(tcp, true); !slices.Equal(got, []int{28125, 30040}) {
		t.Errorf("tcp: %v", got)
	}
	udp6 := filepath.Join(dir, "udp6")
	os.WriteFile(udp6, []byte(`  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops
  10: 00000000000000000000000000000000:7595 00000000000000000000000000000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 4 2 0000000000000000 0
`), 0o644)
	if got := socketPorts(udp6, false); !slices.Equal(got, []int{30101}) {
		t.Errorf("udp6: %v", got)
	}
	if socketPorts(filepath.Join(dir, "none"), true) != nil {
		t.Error("missing file")
	}
}
