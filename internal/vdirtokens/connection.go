// Connection-string encoding for app tokens. A connection string is an
// opaque, versioned value that carries everything a client needs to
// reach one vdir: the server origin, the vdir id, and the plaintext
// token. It is deliberately not a URL (ADR 0016), so a bearer token
// never travels in a URL, query, or fragment.
package vdirtokens

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// ConnectionPrefix makes connection strings recognizable to users and
// secret scanners, and carries the format version.
const ConnectionPrefix = "sfconn_v1_"

// ConnectionPayload is the JSON object carried inside a connection
// string. V is the payload version (always 1 for this prefix).
type ConnectionPayload struct {
	V     int    `json:"v"`
	URL   string `json:"url"`
	Vdir  string `json:"vdir"`
	Token string `json:"token"`
}

// EncodeConnectionString builds the unpadded base64url connection string
// for one origin, vdir, and plaintext token. The origin must be an
// absolute http(s) URL with no credentials, path, query, or fragment.
func EncodeConnectionString(baseURL, vdir, token string) (string, error) {
	baseURL = normalizeOrigin(baseURL)
	if err := validateOrigin(baseURL); err != nil {
		return "", err
	}
	vdir = strings.TrimSpace(vdir)
	if vdir == "" {
		return "", errors.New("vdirtokens: connection string vdir is required")
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return "", errors.New("vdirtokens: connection string token is required")
	}
	raw, err := json.Marshal(ConnectionPayload{
		V:     1,
		URL:   baseURL,
		Vdir:  vdir,
		Token: token,
	})
	if err != nil {
		return "", fmt.Errorf("vdirtokens: encode connection string: %w", err)
	}
	return ConnectionPrefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

// OriginFromRequest derives the absolute origin the requester used.
// HTTPS comes from TLS or the first X-Forwarded-Proto value; the host
// comes from the first X-Forwarded-Host value when present, otherwise
// Host. It returns false when the result is not a usable origin.
func OriginFromRequest(r *http.Request) (string, bool) {
	if r == nil {
		return "", false
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(firstForwarded(r.Header.Get("X-Forwarded-Proto")), "https") {
		scheme = "https"
	}
	host := firstForwarded(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(r.Host)
	}
	if host == "" {
		return "", false
	}
	origin := scheme + "://" + host
	if err := validateOrigin(origin); err != nil {
		return "", false
	}
	return origin, true
}

// firstForwarded returns the first comma-separated element, trimmed.
// Proxies append to forwarded chains, so the first value is the one the
// client actually used.
func firstForwarded(value string) string {
	if i := strings.IndexByte(value, ','); i >= 0 {
		value = value[:i]
	}
	return strings.TrimSpace(value)
}

func normalizeOrigin(raw string) string {
	return strings.TrimRight(strings.TrimSpace(raw), "/")
}

func validateOrigin(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("vdirtokens: invalid connection string origin: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("vdirtokens: connection string origin must use http or https")
	}
	if parsed.Host == "" {
		return errors.New("vdirtokens: connection string origin needs a host")
	}
	if parsed.User != nil {
		return errors.New("vdirtokens: connection string origin must not contain credentials")
	}
	if parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Opaque != "" {
		return errors.New("vdirtokens: connection string origin must not contain a path, query, or fragment")
	}
	return nil
}
