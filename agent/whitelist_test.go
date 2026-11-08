package main

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

func TestWhitelistEntriesListUnknownNamesOffline(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/Fiqolas") {
			w.Write([]byte(`{"id":"x","name":"Fiqolas"}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	mojangAPI = srv.URL
	defer func() { mojangAPI = "" }()

	premium := true
	req := createRequest{Players: []string{"Fiqolas", "MixuPlay"}, OnlineMode: &premium}
	if got := whitelistEntries(&req); !slices.Equal(got, []string{"Fiqolas", "MixuPlay:offline"}) {
		t.Errorf("premium: %v", got)
	}
	if req.Players[1] != "MixuPlay" {
		t.Error("request's list changed")
	}
	cracked := false
	req.OnlineMode = &cracked
	if got := whitelistEntries(&req); !slices.Equal(got, []string{"Fiqolas:offline", "MixuPlay:offline"}) {
		t.Errorf("non-premium: %v", got)
	}
	// Mojang down: names stay as they are.
	srv.Close()
	req.OnlineMode = &premium
	if got := whitelistEntries(&req); !slices.Equal(got, []string{"Fiqolas", "MixuPlay"}) {
		t.Errorf("Mojang down: %v", got)
	}
}
