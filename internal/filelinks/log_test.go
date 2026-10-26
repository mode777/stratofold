package filelinks_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// TestLinkRequestLogIsRedacted asserts the server's own request log
// never retains a reusable token.
func TestLinkRequestLogIsRedacted(t *testing.T) {
	e := setup(t)
	url := mintURL(t, e, e.privID, "docs/a.txt", e.owner)
	token := strings.TrimPrefix(strings.TrimPrefix(url, e.s.BaseURL), "/s/")

	mustStatus(t, e.get(t, url, nil, nil), 200)

	deadline := time.Now().Add(5 * time.Second)
	sawRedacted := false
	for time.Now().Before(deadline) {
		var logs []*core.Log
		if err := e.s.App.LogQuery().All(&logs); err == nil {
			for _, entry := range logs {
				text := entry.Message + " " + fmt.Sprint(entry.Data)
				if strings.Contains(text, token) {
					t.Fatalf("request log retained the token: %s", text)
				}
				if strings.Contains(text, "/s/[redacted]") {
					sawRedacted = true
				}
			}
		}
		if sawRedacted {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("no redacted /s/ log entry appeared")
}
