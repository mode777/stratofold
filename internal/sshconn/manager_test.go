package sshconn_test

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pkg/sftp"

	"github.com/mode777/stratofold/internal/sftpreadwrite"
	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/ssherr"
	"github.com/mode777/stratofold/internal/testssh"
)

// TestOnDemandDialAndReuse: first operation dials; the second reuses
// the healthy connection (spec: ssh-connection-management).
func TestOnDemandDialAndReuse(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	var dials atomic.Int64
	m, err := f.NewManager(sshconn.WithDialHook(func() { dials.Add(1) }))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	tr := sftpreadwrite.New(m, f.Path("hello.txt"), sftpreadwrite.Options{})
	for i := 0; i < 5; i++ {
		b, err := tr.ReadRange(context.Background(), 0, 6)
		if err != nil {
			t.Fatal(err)
		}
		if string(b) != "hello " {
			t.Fatalf("read %q", b)
		}
	}
	if n := dials.Load(); n != 1 {
		t.Fatalf("dial count = %d, want 1 (connection must be reused)", n)
	}
}

// TestIdleTTLEviction: idle connections close after the TTL (fake
// clock); the next operation dials fresh; in-use connections survive.
func TestIdleTTLEviction(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	fc := sshconn.NewFakeClock(time.Now())
	var dials atomic.Int64
	cfgTTL := 20 * time.Minute

	m, err := sshconn.NewManager(mgrCfg(f, cfgTTL),
		sshconn.WithClock(fc), sshconn.WithDialHook(func() { dials.Add(1) }))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	cl, release, err := m.Client(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n := dials.Load(); n != 1 {
		t.Fatalf("dial count = %d, want 1", n)
	}
	// In use: must survive beyond TTL.
	for i := 0; i < 5; i++ {
		fc.Advance(cfgTTL / 4)
	}
	if m.State() != sshconn.StateHealthy {
		t.Fatalf("state = %v while in use past TTL", m.State())
	}
	_ = cl
	release()

	// Idle now: eviction after TTL. Advance queues the ticks; the
	// watchdog processes them asynchronously.
	for i := 0; i < 4; i++ {
		fc.Advance(cfgTTL / 4)
	}
	waitForState(t, m, sshconn.StateNoConn, 2*time.Second)
	if m.State() != sshconn.StateNoConn {
		t.Fatalf("state = %v after idle TTL, want no-conn (evicted)", m.State())
	}

	// Next operation dials a fresh connection.
	tr := sftpreadwrite.New(m, f.Path("hello.txt"), sftpreadwrite.Options{})
	if _, err := tr.ReadRange(context.Background(), 0, 5); err != nil {
		t.Fatal(err)
	}
	if n := dials.Load(); n != 2 {
		t.Fatalf("dial count = %d, want 2 after eviction", n)
	}
}

// TestReconnectAfterDrop: after the connection is killed, the manager
// re-establishes it without operator intervention; state cycles.
func TestReconnectAfterDrop(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	var dials atomic.Int64
	m, err := f.NewManager(sshconn.WithDialHook(func() { dials.Add(1) }))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	ctx := context.Background()
	cl, release, err := m.Client(ctx)
	if err != nil {
		t.Fatal(err)
	}
	release()

	if f.Mode == testssh.ModeInproc {
		f.DropAllConnections()
	} else {
		// No server-side kill available: close the client-side conn.
		cl.Close()
	}
	// The manager still hands out the (now dead) client; the operation
	// layer observes a retryable failure and Invalidates it.
	stale, rel2, err := m.Client(ctx)
	if err != nil {
		t.Fatal(err)
	}
	m.Invalidate(cl)
	rel2()
	_ = stale

	tr := sftpreadwrite.New(m, f.Path("hello.txt"), sftpreadwrite.Options{})
	if _, err := tr.ReadRange(ctx, 0, 17); err != nil {
		t.Fatalf("op after reconnect: %v", err)
	}
	if m.State() != sshconn.StateHealthy {
		t.Fatalf("state = %v after reconnect", m.State())
	}
	if n := dials.Load(); n < 2 {
		t.Fatalf("dial count = %d, want >= 2", n)
	}
}

// TestHostKeyMismatchPermanent: wrong fingerprint → permanent error on
// first dial, no retry storm (spec: host key changes abort).
func TestHostKeyMismatchPermanent(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	var dials atomic.Int64
	cfg := mgrCfg(f, 20*time.Minute)
	cfg.HostKeyFingerprint = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	m, err := sshconn.NewManager(cfg, sshconn.WithDialHook(func() { dials.Add(1) }))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	start := time.Now()
	_, _, err = m.Client(context.Background())
	if !errors.Is(err, ssherr.ErrHostKeyMismatch) {
		t.Fatalf("err = %v, want host key mismatch", err)
	}
	if dials.Load() != 1 {
		t.Fatalf("dial count = %d, want exactly 1 (permanent: no retries)", dials.Load())
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("permanent error took %v — must fail immediately", time.Since(start))
	}
}

// TestConcurrentOpsAcrossReconnect: operations issued while the
// connection is being re-established either complete against the new
// connection or are retried to completion — none is partially applied.
func TestConcurrentOpsAcrossReconnect(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	m, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	src := testssh.RandomBytes(11, 256*1024)
	writeDirect(t, f, "conc.bin", src)

	var wg sync.WaitGroup
	errs := make([]error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			tr := sftpreadwrite.New(m, f.Path("conc.bin"), sftpreadwrite.Options{})
			b, err := tr.ReadRange(context.Background(), int64(i)*1024, 512)
			if err != nil {
				errs[i] = err
				return
			}
			if string(b) != string(src[int64(i)*1024:int64(i)*1024+512]) {
				errs[i] = errors.New("byte mismatch (partial application?)")
			}
		}(i)
	}

	// Kill connections mid-flight, twice.
	if f.Mode == testssh.ModeInproc {
		go func() {
			time.Sleep(5 * time.Millisecond)
			f.DropAllConnections()
			time.Sleep(5 * time.Millisecond)
			f.DropAllConnections()
		}()
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d: %v", i, err)
		}
	}
	if m.State() != sshconn.StateHealthy {
		t.Fatalf("state = %v, want healthy after reconnects", m.State())
	}
}

// TestClientClosedErrors: a closed manager refuses operations.
func TestClientClosedErrors(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()
	m, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := m.Client(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := m.Client(context.Background()); err == nil {
		t.Fatal("expected error after Close")
	}
}

// TestHostKeyCaptureOnFirstUse: an unpinned manager accepts the first
// host key, pins it, and reports it through the capture hook exactly
// once (spec: host key changes abort — unpinned connection captures).
func TestHostKeyCaptureOnFirstUse(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	var mu sync.Mutex
	var captured []string
	cfg := mgrCfg(f, 20*time.Minute)
	cfg.HostKeyFingerprint = ""
	m, err := sshconn.NewManager(cfg, sshconn.WithHostKeyCapture(func(fp string) {
		mu.Lock()
		captured = append(captured, fp)
		mu.Unlock()
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	tr := sftpreadwrite.New(m, f.Path("hello.txt"), sftpreadwrite.Options{})
	if _, err := tr.ReadRange(context.Background(), 0, 6); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	got := append([]string(nil), captured...)
	mu.Unlock()
	if len(got) != 1 || got[0] != f.Fingerprint {
		t.Fatalf("capture hook calls = %v, want [%s]", got, f.Fingerprint)
	}
	if m.Config().HostKeyFingerprint != f.Fingerprint {
		t.Fatalf("manager fingerprint = %q, want %q", m.Config().HostKeyFingerprint, f.Fingerprint)
	}

	// Reusing the healthy connection must not re-invoke the hook.
	tr2 := sftpreadwrite.New(m, f.Path("hello.txt"), sftpreadwrite.Options{})
	if _, err := tr2.ReadRange(context.Background(), 0, 6); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	n := len(captured)
	mu.Unlock()
	if n != 1 {
		t.Fatalf("capture hook called %d times, want 1", n)
	}
}

// TestCapturedFingerprintEnforcedOnLaterConnection: after first-use
// capture, a host presenting a different key is refused permanently.
// Requires two fixtures with distinct host keys, so inproc only.
func TestCapturedFingerprintEnforcedOnLaterConnection(t *testing.T) {
	f1 := testssh.Start(t, testssh.Options{})
	defer f1.Close()
	if f1.Mode != testssh.ModeInproc {
		t.Skip("needs two fixtures with distinct host keys (inproc)")
	}
	f2 := testssh.Start(t, testssh.Options{})
	defer f2.Close()
	if f1.Fingerprint == f2.Fingerprint {
		t.Fatal("fixtures share a host key; test cannot distinguish")
	}

	// First use against f1 captures f1's fingerprint.
	cfg := mgrCfg(f1, 20*time.Minute)
	cfg.HostKeyFingerprint = ""
	var captured string
	m1, err := sshconn.NewManager(cfg, sshconn.WithHostKeyCapture(func(fp string) { captured = fp }))
	if err != nil {
		t.Fatal(err)
	}
	defer m1.Close()
	tr := sftpreadwrite.New(m1, f1.Path("hello.txt"), sftpreadwrite.Options{})
	if _, err := tr.ReadRange(context.Background(), 0, 6); err != nil {
		t.Fatal(err)
	}
	if captured != f1.Fingerprint {
		t.Fatalf("captured %q, want %q", captured, f1.Fingerprint)
	}

	// A manager pinned to the captured fingerprint refuses f2's key.
	cfg2 := mgrCfg(f2, 20*time.Minute)
	cfg2.HostKeyFingerprint = captured
	m2, err := sshconn.NewManager(cfg2)
	if err != nil {
		t.Fatal(err)
	}
	defer m2.Close()
	if _, _, err := m2.Client(context.Background()); !errors.Is(err, ssherr.ErrHostKeyMismatch) {
		t.Fatalf("err = %v, want host key mismatch", err)
	}
}

// TestFailedAuthDoesNotPin: the host key is accepted during the
// handshake but authentication fails, so nothing is captured (spec:
// failed authentication does not pin).
func TestFailedAuthDoesNotPin(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	var calls atomic.Int64
	cfg := mgrCfg(f, 20*time.Minute)
	cfg.HostKeyFingerprint = ""
	cfg.Password = "definitely-wrong"
	m, err := sshconn.NewManager(cfg, sshconn.WithHostKeyCapture(func(string) { calls.Add(1) }))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	if _, _, err := m.Client(ctx); err == nil {
		t.Fatal("expected authentication failure")
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("capture hook called %d times after failed auth, want 0", n)
	}
	if m.Config().HostKeyFingerprint != "" {
		t.Fatalf("fingerprint pinned after failed auth: %q", m.Config().HostKeyFingerprint)
	}
}

func mgrCfg(f *testssh.Fixture, ttl time.Duration) sshconn.Config {
	return sshconn.Config{
		Host:               f.Host,
		Port:               f.Port,
		User:               f.User,
		Password:           f.Password,
		HostKeyFingerprint: f.Fingerprint,
		IdleTTL:            ttl,
		Backoff: sshconn.BackoffConfig{
			Base: 2 * time.Millisecond, Factor: 2, Cap: 100 * time.Millisecond, Jitter: false,
		},
	}
}

// waitForState polls until the manager reaches want (the watchdog is
// asynchronous).
func waitForState(t *testing.T, m *sshconn.Manager, want sshconn.State, max time.Duration) {
	t.Helper()
	deadline := time.Now().Add(max)
	for time.Now().Before(deadline) {
		if m.State() == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// writeDirect seeds a file via a plain SFTP client (bypasses the code
// under test).
func writeDirect(t *testing.T, f *testssh.Fixture, rel string, data []byte) {
	t.Helper()
	cl, err := f.SSHClient()
	if err != nil {
		t.Fatal(err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatal(err)
	}
	defer scl.Close()
	fp, err := scl.Create(f.Path(rel))
	if err != nil {
		t.Fatal(err)
	}
	defer fp.Close()
	if _, err := fp.Write(data); err != nil {
		t.Fatal(err)
	}
}
