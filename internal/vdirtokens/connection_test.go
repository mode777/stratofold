package vdirtokens_test

import (
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/mode777/stratofold/internal/vdirtokens"
)

func decodeConnectionString(t *testing.T, value string) vdirtokens.ConnectionPayload {
	t.Helper()
	if !strings.HasPrefix(value, vdirtokens.ConnectionPrefix) {
		t.Fatalf("connection string %q lacks prefix %q", value, vdirtokens.ConnectionPrefix)
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, vdirtokens.ConnectionPrefix))
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	var payload vdirtokens.ConnectionPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	return payload
}

func TestConnectionStringRoundTrip(t *testing.T) {
	got, err := vdirtokens.EncodeConnectionString("https://files.example.com/", "vdir123", "sf_v1_secret")
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	payload := decodeConnectionString(t, got)
	if payload.V != 1 {
		t.Fatalf("payload version = %d, want 1", payload.V)
	}
	if payload.URL != "https://files.example.com" {
		t.Fatalf("payload url = %q", payload.URL)
	}
	if payload.Vdir != "vdir123" || payload.Token != "sf_v1_secret" {
		t.Fatalf("payload facts wrong: %+v", payload)
	}

	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("connection string unexpectedly parsed as a URL: %v", err)
	}
	if parsed.Scheme == "http" || parsed.Scheme == "https" {
		t.Fatalf("connection string resolved as an HTTP URL: %q", parsed)
	}
}

func TestEncodeConnectionStringRejectsInvalidInput(t *testing.T) {
	cases := []struct {
		name   string
		origin string
		vdir   string
		token  string
	}{
		{name: "empty origin", origin: "", vdir: "v", token: "t"},
		{name: "relative origin", origin: "files.example.com", vdir: "v", token: "t"},
		{name: "wrong scheme", origin: "ftp://files.example.com", vdir: "v", token: "t"},
		{name: "missing host", origin: "https://", vdir: "v", token: "t"},
		{name: "credentials", origin: "https://user@files.example.com", vdir: "v", token: "t"},
		{name: "path", origin: "https://files.example.com/sub", vdir: "v", token: "t"},
		{name: "query", origin: "https://files.example.com?x=1", vdir: "v", token: "t"},
		{name: "fragment", origin: "https://files.example.com#frag", vdir: "v", token: "t"},
		{name: "opaque", origin: "https:files.example.com", vdir: "v", token: "t"},
		{name: "empty vdir", origin: "https://files.example.com", vdir: " ", token: "t"},
		{name: "empty token", origin: "https://files.example.com", vdir: "v", token: " "},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got, err := vdirtokens.EncodeConnectionString(tc.origin, tc.vdir, tc.token); err == nil {
				t.Fatalf("expected error, got %q", got)
			}
		})
	}
}

func TestOriginFromRequest(t *testing.T) {
	cases := []struct {
		name   string
		req    *http.Request
		want   string
		wantOK bool
	}{
		{name: "nil request", req: nil},
		{
			name:   "plain http",
			req:    &http.Request{Host: "files.example.com"},
			want:   "http://files.example.com",
			wantOK: true,
		},
		{
			name:   "direct tls",
			req:    &http.Request{Host: "files.example.com", TLS: &tls.ConnectionState{}},
			want:   "https://files.example.com",
			wantOK: true,
		},
		{
			name: "forwarded https",
			req: &http.Request{
				Host:   "files.example.com",
				Header: http.Header{"X-Forwarded-Proto": {"https"}},
			},
			want:   "https://files.example.com",
			wantOK: true,
		},
		{
			name: "forwarded proto list first wins",
			req: &http.Request{
				Host:   "files.example.com",
				Header: http.Header{"X-Forwarded-Proto": {"https, http"}},
			},
			want:   "https://files.example.com",
			wantOK: true,
		},
		{
			name: "forwarded proto list http first",
			req: &http.Request{
				Host:   "files.example.com",
				Header: http.Header{"X-Forwarded-Proto": {"http, https"}},
			},
			want:   "http://files.example.com",
			wantOK: true,
		},
		{
			name: "forwarded host wins",
			req: &http.Request{
				Host: "internal:8090",
				Header: http.Header{
					"X-Forwarded-Host": {"drive.example.com, internal:8090"},
				},
			},
			want:   "http://drive.example.com",
			wantOK: true,
		},
		{
			name: "forwarded host trimmed",
			req: &http.Request{
				Host:   "internal:8090",
				Header: http.Header{"X-Forwarded-Host": {"  drive.example.com  "}},
			},
			want:   "http://drive.example.com",
			wantOK: true,
		},
		{
			name:   "ipv6 host",
			req:    &http.Request{Host: "[::1]:8090"},
			want:   "http://[::1]:8090",
			wantOK: true,
		},
		{
			name:   "empty host",
			req:    &http.Request{},
			wantOK: false,
		},
		{
			name: "forwarded host with path is unusable",
			req: &http.Request{
				Host:   "files.example.com",
				Header: http.Header{"X-Forwarded-Host": {"drive.example.com/evil"}},
			},
			wantOK: false,
		},
		{
			name:   "host with credentials is unusable",
			req:    &http.Request{Host: "user@files.example.com"},
			wantOK: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := vdirtokens.OriginFromRequest(tc.req)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v (origin %q)", ok, tc.wantOK, got)
			}
			if got != tc.want {
				t.Fatalf("origin = %q, want %q", got, tc.want)
			}
		})
	}
}
