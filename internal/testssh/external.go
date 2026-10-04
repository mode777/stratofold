package testssh

import (
	"fmt"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"testing"
)

// startExternal attaches the fixture to a real existing OpenSSH
// endpoint via environment variables:
//
//	SF_TESTSSH_HOST         required
//	SF_TESTSSH_PORT         optional (default 22)
//	SF_TESTSSH_USER         required
//	SF_TESTSSH_PASSWORD     required
//	SF_TESTSSH_FINGERPRINT  optional; captured on first contact if unset
//
// The dataset is seeded under $HOME/sf-test-<random>/ on the remote and
// removed at test end.
func startExternal(t *testing.T) *Fixture {
	t.Helper()
	host := os.Getenv("SF_TESTSSH_HOST")
	user := os.Getenv("SF_TESTSSH_USER")
	password := os.Getenv("SF_TESTSSH_PASSWORD")
	if host == "" || user == "" || password == "" {
		t.Skip("testssh: external mode needs SF_TESTSSH_HOST, SF_TESTSSH_USER, SF_TESTSSH_PASSWORD")
	}
	port := 22
	if p := os.Getenv("SF_TESTSSH_PORT"); p != "" {
		if v, err := strconv.Atoi(p); err == nil {
			port = v
		}
	}
	f := &Fixture{
		Host:        host,
		Port:        port,
		User:        user,
		Password:    password,
		Fingerprint: os.Getenv("SF_TESTSSH_FINGERPRINT"),
	}
	f.fpKnown = f.Fingerprint != ""

	// Contact (captures the fingerprint if unset) and create the root.
	if _, err := f.Exec("true"); err != nil {
		t.Fatalf("testssh: cannot reach external ssh %s@%s:%d: %v", user, host, port, err)
	}
	home, err := homeDir(f)
	if err != nil {
		t.Fatalf("testssh: external home: %v", err)
	}
	root := fmt.Sprintf("%s/sf-test-%d-%x", home, os.Getpid(), rand.Uint32())
	if err := ensureRootPrefix(root); err != nil {
		t.Fatal(err)
	}
	f.Root = root
	if _, err := f.Exec("mkdir -p " + root); err != nil {
		t.Fatalf("testssh: external mkdir: %v", err)
	}
	t.Cleanup(func() {
		if ensureRootPrefix(f.Root) == nil {
			_, _ = f.Exec("rm -rf " + f.Root)
		}
		f.Close()
	})
	return f
}

func homeDir(f *Fixture) (string, error) {
	cl, err := f.SSHClient()
	if err != nil {
		return "", err
	}
	sess, err := cl.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()
	out, err := sess.Output("pwd")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
