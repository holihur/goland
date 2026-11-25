package server

import "testing"

func TestAPIURLAndTruncate(t *testing.T) {
	base := "https://api.example.com"
	cases := map[string]string{
		apiURL(base, "openai", "models"):          base + "/v1/models",
		apiURL(base+"/v1", "openai", "models"):    base + "/v1/models",
		apiURL(base, "openai", "chat"):            base + "/v1/chat/completions",
		apiURL(base+"/v1", "openai", "chat"):      base + "/v1/chat/completions",
		apiURL(base, "anthropic", "models"):       base + "/v1/models",
		apiURL(base+"/v1", "anthropic", "models"): base + "/v1/models",
		apiURL(base, "anthropic", "chat"):         base + "/v1/messages",
		apiURL(base+"/v1", "anthropic", "chat"):   base + "/v1/messages",
	}
	for got, want := range cases {
		if got != want {
			t.Fatalf("apiURL = %q, want %q", got, want)
		}
	}
	if got := truncateText("short", 10); got != "short" {
		t.Fatalf("truncate short = %q", got)
	}
	if got := truncateText("0123456789", 5); got != "01234…" {
		t.Fatalf("truncate long = %q", got)
	}
}
