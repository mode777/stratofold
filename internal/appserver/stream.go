package appserver

import (
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// ClearStreamDeadlines is a route middleware for streaming-designated
// routes (design D5): it clears the per-request read/write deadlines so
// a long transfer is not terminated by the server's timeouts. It must
// be applied per route (change 4 applies it to /files/* as well); it
// does not disable any other server protection.
func ClearStreamDeadlines() func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		rc := http.NewResponseController(e.Response)
		if err := rc.SetWriteDeadline(time.Time{}); err != nil {
			return err
		}
		if err := rc.SetReadDeadline(time.Time{}); err != nil {
			return err
		}
		return e.Next()
	}
}
