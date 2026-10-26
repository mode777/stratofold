// Package appserver wires the Stratofold application server: the
// embedded PocketBase app (ADR 0002) plus the /api/sf/* custom surface,
// including the streaming-friendly HTTP server timeout configuration.
package appserver

import (
	"net"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"

	"github.com/mode777/stratofold/internal/authbridge"
	"github.com/mode777/stratofold/internal/connreg"
	"github.com/mode777/stratofold/internal/filelinks"
	"github.com/mode777/stratofold/internal/fileserver"
	"github.com/mode777/stratofold/internal/fsapi"
	// app migrations (connections/vdirs collections) register on import.
	_ "github.com/mode777/stratofold/internal/migrations"
	"github.com/mode777/stratofold/internal/userlookup"
	"github.com/mode777/stratofold/internal/vdirmeta"
	"github.com/mode777/stratofold/internal/webassets"
)

// TimeoutConfig are the http.Server timeout tunables. The zero fields
// mean "no deadline" where allowed.
type TimeoutConfig struct {
	Read       time.Duration
	Write      time.Duration
	ReadHeader time.Duration
	Idle       time.Duration
}

// DefaultTimeouts are the production values (design D5): no overall
// read/write deadline so tens-of-GB streams are never killed by a
// framework default, while the slowloris and idle-connection
// protections stay bounded.
func DefaultTimeouts() TimeoutConfig {
	return TimeoutConfig{
		Read:       0,
		Write:      0,
		ReadHeader: 1 * time.Minute,
		Idle:       2 * time.Minute,
	}
}

// Options are the bootstrap options. The zero value is production
// wiring; tests override Listener and Timeouts.
type Options struct {
	// DataDir is the SQLite/pb_data directory.
	DataDir string

	// Listener optionally provides a pre-created listener (tests);
	// when nil, the server listens on its configured address.
	Listener net.Listener

	// Timeouts overrides the server timeouts (tests). nil = defaults.
	Timeouts *TimeoutConfig
}

// Install binds the Stratofold server hooks (timeout configuration,
// optional listener, the connection record registry, custom routes)
// onto a PocketBase app instance. Call before app.Bootstrap/Start.
//
// App migrations apply on serve: apis.Serve runs RunAllMigrations
// before binding the router (the production serve command and the
// test harness both go through it; the _migrations table makes the
// run idempotent).
func Install(app core.App, opts Options) {
	// Connection records ↔ SSH managers (sealing, hiding, invalidation).
	connreg.Register(app)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		timeouts := DefaultTimeouts()
		if opts.Timeouts != nil {
			timeouts = *opts.Timeouts
		}
		applyTimeouts(se.Server, timeouts)

		if opts.Listener != nil {
			se.Listener = opts.Listener
		}

		authbridge.RegisterRoutes(se.Router.RouterGroup)
		fileserver.RegisterRoutes(se.Router.RouterGroup,
			&hook.Handler[*core.RequestEvent]{Func: ClearStreamDeadlines()})
		filelinks.RegisterRoutes(se.Router.RouterGroup,
			&hook.Handler[*core.RequestEvent]{Func: ClearStreamDeadlines()})
		fsapi.RegisterRoutes(se.Router.RouterGroup,
			&hook.Handler[*core.RequestEvent]{Func: ClearStreamDeadlines()})
		userlookup.RegisterRoutes(se.Router.RouterGroup)
		// The public-vdir metadata route is session-free by design;
		// like every custom route it must precede the SPA catch-all.
		vdirmeta.RegisterRoutes(se.Router.RouterGroup)
		// The embedded SPA catch-all is registered last so the API
		// routes above (more specific patterns) always win.
		webassets.RegisterRoutes(se.Router.RouterGroup)
		return se.Next()
	})
}

func applyTimeouts(srv *http.Server, c TimeoutConfig) {
	srv.ReadTimeout = c.Read
	srv.WriteTimeout = c.Write
	srv.ReadHeaderTimeout = c.ReadHeader
	srv.IdleTimeout = c.Idle
}
