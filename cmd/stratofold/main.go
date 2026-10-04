// Command stratofold is the Stratofold cloud file manager server: a
// single binary embedding PocketBase (ADR 0002) on one port with the
// /api/sf/* custom surface.
package main

import (
	"log"

	"github.com/pocketbase/pocketbase"

	"github.com/mode777/stratofold/internal/appserver"
)

func main() {
	app := pocketbase.New()

	appserver.Install(app, appserver.Options{})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
