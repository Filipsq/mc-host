package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"unicode"
)

// A Java server's resource pack (texture pack): the game downloads it from the
// link when a player joins. The site checks the link leads to a zip and works
// out its SHA-1, so players' games fetch it again only when it changes.
type resourcePack struct {
	URL      string `json:"url"` // empty: no pack
	SHA1     string `json:"sha1"`
	Required bool   `json:"required"` // players who decline it are disconnected
	Prompt   string `json:"prompt"`   // the line the game shows with the question
}

var validSHA1 = regexp.MustCompile(`^([0-9a-f]{40})?$`)

func (p *resourcePack) validate() error {
	if p == nil {
		return nil
	}
	if p.URL != "" {
		u, err := url.Parse(p.URL)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || len(p.URL) > 1000 || strings.ContainsFunc(p.URL, unicode.IsSpace) {
			return errors.New("resourcePack.url must be an http(s) link")
		}
	}
	switch {
	case !validSHA1.MatchString(p.SHA1):
		return errors.New("resourcePack.sha1 must be 40 lowercase hex digits")
	case len([]rune(p.Prompt)) > 150 || strings.ContainsFunc(p.Prompt, unicode.IsControl):
		return errors.New("resourcePack.prompt must be one line of up to 150 characters")
	}
	return nil
}

// env sets all four properties, so taking the pack off clears them too. Nothing
// for a request without a pack, which leaves server.properties as it is.
func (p *resourcePack) env() []string {
	if p == nil {
		return nil
	}
	prompt := ""
	if p.URL != "" && p.Prompt != "" {
		// Minecraft reads the prompt as a text component.
		var b bytes.Buffer
		enc := json.NewEncoder(&b)
		enc.SetEscapeHTML(false)
		_ = enc.Encode(map[string]string{"text": p.Prompt})
		prompt = strings.TrimSpace(b.String())
	}
	return []string{"RESOURCE_PACK=" + p.URL, "RESOURCE_PACK_SHA1=" + p.SHA1,
		fmt.Sprintf("RESOURCE_PACK_ENFORCE=%v", p.URL != "" && p.Required), "RESOURCE_PACK_PROMPT=" + prompt}
}
