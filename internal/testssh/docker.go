package testssh

import (
	"net"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

// startDocker boots the dockerized OpenSSH fixture (bring-up
// verification deferred: see D7 environment note in the change
// design — no Docker daemon is currently reachable).
func startDocker(t *testing.T) *Fixture {
	t.Helper()
	if err := exec.Command("docker", "compose", "version").Run(); err != nil {
		t.Skip("testssh: docker compose unavailable")
	}
	_, thisFile, _, _ := runtime.Caller(0)
	dir := filepath.Dir(thisFile)

	project := "sf-test-" + strconv.FormatUint(uint64(time.Now().UnixNano()), 36)
	up := func(args ...string) (string, error) {
		cmd := exec.Command("docker", append([]string{"compose", "-f", filepath.Join(dir, "compose.yaml"), "-p", project}, args...)...)
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	if out, err := up("up", "-d"); err != nil {
		t.Fatalf("testssh: docker compose up: %v: %s", err, out)
	}
	t.Cleanup(func() {
		_, _ = up("down", "-v")
	})

	// Resolve the ephemeral host port.
	var port int
	deadline := time.Now().Add(30 * time.Second)
	for port == 0 {
		out, err := up("port", "openssh", "2222")
		if err == nil {
			_, portStr, perr := net.SplitHostPort(strings.TrimSpace(out))
			if perr == nil {
				port, _ = strconv.Atoi(portStr)
			}
		}
		if port != 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("testssh: docker fixture port never resolved")
		}
		time.Sleep(500 * time.Millisecond)
	}

	f := &Fixture{
		Host:     "127.0.0.1",
		Port:     port,
		User:     fixtureUser,
		Password: fixturePassword,
		Root:     "/data",
	}
	t.Cleanup(f.Close)

	// Wait for sshd; the first contact captures (TOFU) the host key
	// fingerprint.
	deadline = time.Now().Add(90 * time.Second)
	for {
		if _, err := f.Exec("true"); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("testssh: docker fixture sshd never became ready")
		}
		time.Sleep(500 * time.Millisecond)
	}
	if f.Fingerprint == "" {
		t.Fatal("testssh: docker fixture produced no fingerprint")
	}
	return f
}
