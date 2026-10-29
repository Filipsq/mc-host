package main

import (
	"slices"
	"testing"
)

func TestResourcePackEnv(t *testing.T) {
	var none *resourcePack
	if env := none.env(); env != nil {
		t.Errorf("no pack should leave server.properties alone, got %v", env)
	}
	p := &resourcePack{URL: "https://dl.example.com/pack.zip", SHA1: "0123456789abcdef0123456789abcdef01234567", Required: true, Prompt: "Pobierz paczkę & graj"}
	if err := p.validate(); err != nil {
		t.Fatal(err)
	}
	want := []string{"RESOURCE_PACK=https://dl.example.com/pack.zip", "RESOURCE_PACK_SHA1=0123456789abcdef0123456789abcdef01234567",
		"RESOURCE_PACK_ENFORCE=true", `RESOURCE_PACK_PROMPT={"text":"Pobierz paczkę & graj"}`}
	if got := p.env(); !slices.Equal(got, want) {
		t.Errorf("env = %v, want %v", got, want)
	}
	off := &resourcePack{Required: true, Prompt: "x"}
	if got := off.env(); !slices.Equal(got, []string{"RESOURCE_PACK=", "RESOURCE_PACK_SHA1=", "RESOURCE_PACK_ENFORCE=false", "RESOURCE_PACK_PROMPT="}) {
		t.Errorf("taking the pack off should clear all four, got %v", got)
	}
	for _, bad := range []resourcePack{{URL: "ftp://x/pack.zip"}, {URL: "https://x/a b.zip"}, {URL: "https://x/p.zip", SHA1: "ABC"}, {URL: "https://x/p.zip", Prompt: "a\nb"}} {
		if bad.validate() == nil {
			t.Errorf("%+v should be refused", bad)
		}
	}
}
