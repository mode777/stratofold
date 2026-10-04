// Package testssh provides the throwaway SSH/SFTP test fixture with a
// seeded dataset (including a multi-GB sparse file). Three backends
// (see the change design doc, D7):
//
//   - docker:   dockerized OpenSSH started via docker compose
//   - external: a real existing OpenSSH endpoint via SF_TESTSSH_* env
//   - inproc:   an in-process SSH/SFTP server (deterministic kill
//     hooks; runs anywhere)
//
// Docker-mode bring-up verification is deferred: neither the dev
// container nor the build server currently runs a Docker daemon.
package testssh

import (
	"context"
	"fmt"
	"io"
	"math/rand"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"

	"github.com/mode777/stratofold/internal/sshconn"
)

// Mode selects the fixture backend.
type Mode string

const (
	ModeAuto     Mode = "auto"
	ModeDocker   Mode = "docker"
	ModeExternal Mode = "external"
	ModeInproc   Mode = "inproc"
)

const (
	fixtureUser     = "testuser"
	fixturePassword = "sf-fixture-password"
	SparseSize      = int64(4) << 30 // 4 GiB sparse file
)

// Options select the backend.
type Options struct {
	Mode Mode
}

// Fixture is a started, seeded SSH/SFTP target.
type Fixture struct {
	Mode        Mode
	Host        string
	Port        int
	User        string
	Password    string
	Fingerprint string
	Root        string // absolute remote root of the dataset

	inproc *Inproc

	mu        sync.Mutex
	sshCl     *ssh.Client
	fpKnown   bool
	fpCapture string
}

// Start boots the fixture (resolving the mode) and seeds the dataset.
func Start(t *testing.T, opts Options) *Fixture {
	t.Helper()
	mode := opts.Mode
	if mode == "" || mode == ModeAuto {
		mode = resolveAuto()
	}
	var f *Fixture
	switch mode {
	case ModeExternal:
		f = startExternal(t)
	case ModeDocker:
		f = startDocker(t)
	case ModeInproc:
		f = startInprocFixture(t)
	default:
		t.Fatalf("testssh: unknown fixture mode %q", mode)
	}
	f.Mode = mode
	f.seed(t)
	t.Logf("testssh: fixture mode=%s root=%s", mode, f.Root)
	return f
}

func resolveAuto() Mode {
	if m := Mode(os.Getenv("SF_TESTSSH_MODE")); m != "" {
		return m
	}
	if dockerUsable() {
		return ModeDocker
	}
	return ModeInproc
}

func dockerUsable() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", "info", "--format", "{{.ServerVersion}}")
	return cmd.Run() == nil
}

// NewManager returns a Manager pointed at the fixture with test-fast
// backoff defaults. SF_SFTP_MAXPACKET overrides the SFTP max packet
// size (gate tunable).
func (f *Fixture) NewManager(extra ...sshconn.Option) (*sshconn.Manager, error) {
	cfg := sshconn.Config{
		Host:               f.Host,
		Port:               f.Port,
		User:               f.User,
		Password:           f.Password,
		HostKeyFingerprint: f.Fingerprint,
		Backoff: sshconn.BackoffConfig{
			Base:   5 * time.Millisecond,
			Factor: 2,
			Cap:    200 * time.Millisecond,
			Jitter: false,
		},
		IdleTTL: sshconn.DefaultIdleTTL,
	}
	if v := os.Getenv("SF_SFTP_MAXPACKET"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.SFTPMaxPacket = n
		}
	}
	return sshconn.NewManager(cfg, extra...)
}

// Path returns the absolute remote path of rel under the dataset root.
func (f *Fixture) Path(rel string) string {
	return f.Root + "/" + rel
}

// DropAllConnections hard-closes every active server-side connection
// (outage simulation). Only the inproc backend supports it.
func (f *Fixture) DropAllConnections() {
	if f.inproc != nil {
		f.inproc.DropAll()
	}
}

// TotalConns reports how many connections the inproc backend accepted
// (0 for other backends).
func (f *Fixture) TotalConns() int {
	if f.inproc != nil {
		return f.inproc.TotalConns()
	}
	return -1
}

// ArmKills queues per-connection server-side kill thresholds (inproc
// backend only; no-op elsewhere).
func (f *Fixture) ArmKills(thresholds []int64) {
	if f.inproc != nil {
		f.inproc.ArmKills(thresholds)
	}
}

// SSHClient returns a cached direct SSH client (password auth, pinned
// host key).
func (f *Fixture) SSHClient() (*ssh.Client, error) {
	f.mu.Lock()
	cl := f.sshCl
	f.mu.Unlock()
	if cl != nil {
		return cl, nil
	}
	cl, err := ssh.Dial("tcp", net.JoinHostPort(f.Host, strconv.Itoa(f.Port)), &ssh.ClientConfig{
		User:            f.User,
		Auth:            []ssh.AuthMethod{ssh.Password(f.Password)},
		HostKeyCallback: insecureCapture(f),
		Timeout:         10 * time.Second,
	})
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	if f.sshCl == nil {
		f.sshCl = cl
	}
	stored := f.sshCl
	f.mu.Unlock()
	if stored != cl {
		cl.Close()
	}
	return stored, nil
}

// insecureCapture pins the fingerprint when known; on first contact
// (TOFU, tests only) it captures it.
func insecureCapture(f *Fixture) ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		got := sshconn.Fingerprint(key)
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.fpKnown {
			f.fpKnown = true
			f.Fingerprint = got
			return nil
		}
		if got != f.Fingerprint {
			return fmt.Errorf("testssh: host key changed: %s != %s", got, f.Fingerprint)
		}
		return nil
	}
}

// Exec runs a whitelisted command remotely (fixture management only).
func (f *Fixture) Exec(cmd string) (string, error) {
	cl, err := f.SSHClient()
	if err != nil {
		return "", err
	}
	sess, err := cl.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()
	out, err := sess.CombinedOutput(cmd)
	return string(out), err
}

// RandomBytes returns deterministic pseudo-random bytes (tests
// regenerate the same bytes locally to compare checksums).
func RandomBytes(seed int64, n int) []byte {
	rng := rand.New(rand.NewSource(seed))
	b := make([]byte, n)
	rng.Read(b)
	return b
}

// seed writes the shared dataset:
//
//	hello.txt             small text file
//	nested/deep/rand1m    1 MiB deterministic random blob
//	secret.bin            small blob, chmod 000 (permanent-error tests)
//	sparse4g.bin          SparseSize sparse file (zero bytes on disk)
func (f *Fixture) seed(t *testing.T) {
	t.Helper()
	for _, dir := range []string{"", "nested", "nested/deep"} {
		if _, err := f.Exec("mkdir -p " + f.Path(dir)); err != nil {
			t.Fatalf("testssh: seed mkdir: %v", err)
		}
	}
	if _, err := f.Exec("truncate -s " + strconv.FormatInt(SparseSize, 10) + " " + f.Path("sparse4g.bin")); err != nil {
		t.Fatalf("testssh: seed sparse file: %v", err)
	}

	cl, err := f.SSHClient()
	if err != nil {
		t.Fatalf("testssh: ssh client: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("testssh: sftp client: %v", err)
	}
	defer scl.Close()

	write := func(rel string, data []byte) {
		fp, err := scl.Create(f.Path(rel))
		if err != nil {
			t.Fatalf("testssh: seed create %s: %v", rel, err)
		}
		defer fp.Close()
		if _, err := fp.Write(data); err != nil {
			t.Fatalf("testssh: seed write %s: %v", rel, err)
		}
	}
	write("hello.txt", []byte("hello stratofold\n"))
	write("nested/deep/rand1m.bin", RandomBytes(42, 1<<20))
	write("secret.bin", RandomBytes(7, 4096))
	if _, err := f.Exec("chmod 000 " + f.Path("secret.bin")); err != nil {
		t.Fatalf("testssh: seed chmod: %v", err)
	}
}

// Close tears the fixture down.
func (f *Fixture) Close() {
	f.mu.Lock()
	cl := f.sshCl
	f.sshCl = nil
	f.mu.Unlock()
	if cl != nil {
		cl.Close()
	}
	if f.inproc != nil {
		f.inproc.Close()
	}
}

func ensureRootPrefix(root string) error {
	if root == "" || !strings.HasPrefix(root, "/") || strings.HasSuffix(root, "/") {
		return fmt.Errorf("testssh: refusing to clean suspicious root %q", root)
	}
	return nil
}

// ReadAllRemote fetches a full remote file via a plain SFTP client
// (debug/test helper independent of the code under test).
func (f *Fixture) ReadAllRemote(t *testing.T, rel string) ([]byte, error) {
	t.Helper()
	cl, err := f.SSHClient()
	if err != nil {
		return nil, err
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		return nil, err
	}
	defer scl.Close()
	rf, err := scl.Open(f.Path(rel))
	if err != nil {
		return nil, err
	}
	defer rf.Close()
	return io.ReadAll(rf)
}
