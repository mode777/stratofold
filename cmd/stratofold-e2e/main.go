// Command stratofold-e2e boots the E2E harness stack (internal/e2eharness)
// on a real HTTP port, prints the base URL and seeded credentials, and
// serves until interrupted. Playwright's webServer uses it, with the
// Vite dev server proxying /api and /files to it.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/mode777/stratofold/internal/e2eharness"
)

func main() {
	dir := flag.String("dir", "", "pb_data directory (default: a fresh temp dir)")
	httpAddr := flag.String("http", "127.0.0.1:8090", "HTTP listen address")
	flag.Parse()

	if *dir == "" {
		tmp, err := os.MkdirTemp("", "sf-e2e-*")
		if err != nil {
			log.Fatalf("stratofold-e2e: temp dir: %v", err)
		}
		*dir = tmp
	}

	stack, err := e2eharness.Start(*dir, *httpAddr)
	if err != nil {
		log.Fatalf("stratofold-e2e: %v", err)
	}
	defer stack.Close()

	fmt.Printf("E2E stack listening at %s\n", stack.BaseURL)
	fmt.Printf("owner: %s / %s\n", e2eharness.OwnerEmail, e2eharness.OwnerPassword)
	fmt.Printf("grantee: %s / %s\n", e2eharness.GranteeEmail, e2eharness.GranteePassword)
	fmt.Printf("vdir: %s public_vdir: %s\n", stack.VdirID, stack.PubID)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
}
