package testssh

import (
	"crypto/ed25519"
	cryptorand "crypto/rand"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"

	"github.com/mode777/stratofold/internal/sshconn"
)

// Inproc is an in-process SSH server serving the SFTP subsystem over a
// plain os directory, plus a whitelisted exec channel (dd, truncate,
// sha256sum, mkdir, rm, chmod) so fixture management and gate
// baselines behave like the external mode. A kill hook can
// hard-close connections after N transferred bytes for deterministic
// chaos tests.
type Inproc struct {
	Root     string
	User     string
	Password string

	lis     net.Listener
	cfg     *ssh.ServerConfig
	Signer  ssh.Signer
	closers sync.WaitGroup

	mu     sync.Mutex
	active map[*killConn]struct{}
	queue  []int64 // per-conn kill thresholds (bytes), FIFO
	conns  int
	total  int
	closed bool
}

func startInprocFixture(t *testing.T) *Fixture {
	t.Helper()
	in, err := StartInproc()
	if err != nil {
		t.Fatalf("testssh: inproc server: %v", err)
	}
	t.Cleanup(in.Close)
	return &Fixture{
		Host:        "127.0.0.1",
		Port:        in.Port(),
		User:        in.User,
		Password:    in.Password,
		Fingerprint: in.Fingerprint(),
		Root:        in.Root,
		inproc:      in,
	}
}

// StartInproc boots the server on 127.0.0.1 with a random port and an
// empty dataset root.
func StartInproc() (*Inproc, error) {
	root, err := os.MkdirTemp("", "sf-testssh-*")
	if err != nil {
		return nil, err
	}
	_, priv, err := ed25519.GenerateKey(cryptorand.Reader)
	if err != nil {
		os.RemoveAll(root)
		return nil, err
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		os.RemoveAll(root)
		return nil, err
	}
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.RemoveAll(root)
		return nil, err
	}
	in := &Inproc{
		Root:     root,
		User:     fixtureUser,
		Password: fixturePassword,
		lis:      lis,
		Signer:   signer,
		active:   map[*killConn]struct{}{},
	}
	in.cfg = &ssh.ServerConfig{
		PasswordCallback: func(meta ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			if meta.User() == in.User && string(password) == in.Password {
				return &ssh.Permissions{}, nil
			}
			return nil, fmt.Errorf("testssh: auth rejected for %q", meta.User())
		},
	}
	in.cfg.AddHostKey(signer)
	in.closers.Add(1)
	go in.acceptLoop()
	return in, nil
}

// Port returns the listening port.
func (in *Inproc) Port() int {
	return in.lis.Addr().(*net.TCPAddr).Port
}

// Fingerprint returns the pinned SHA256 fingerprint of the host key.
func (in *Inproc) Fingerprint() string {
	return sshconn.Fingerprint(in.Signer.PublicKey())
}

// ArmKills queues per-connection kill thresholds: the Nth subsequent
// connection is hard-closed after thresholds[N-1] transferred bytes.
func (in *Inproc) ArmKills(thresholds []int64) {
	in.mu.Lock()
	defer in.mu.Unlock()
	in.queue = append(in.queue, thresholds...)
}

// ActiveConns reports currently open connections.
func (in *Inproc) ActiveConns() int {
	in.mu.Lock()
	defer in.mu.Unlock()
	return in.conns
}

// TotalConns reports how many connections were ever accepted.
func (in *Inproc) TotalConns() int {
	in.mu.Lock()
	defer in.mu.Unlock()
	return in.total
}

// DropAll hard-closes every active connection (outage simulation).
func (in *Inproc) DropAll() {
	in.mu.Lock()
	conns := make([]*killConn, 0, len(in.active))
	for c := range in.active {
		conns = append(conns, c)
	}
	in.mu.Unlock()
	for _, c := range conns {
		c.hardClose()
	}
}

// Close stops the server and removes the dataset root.
func (in *Inproc) Close() {
	in.mu.Lock()
	if in.closed {
		in.mu.Unlock()
		return
	}
	in.closed = true
	lis := in.lis
	conns := make([]*killConn, 0, len(in.active))
	for c := range in.active {
		conns = append(conns, c)
	}
	root := in.Root
	in.mu.Unlock()

	lis.Close()
	for _, c := range conns {
		c.Close()
	}
	in.closers.Wait()
	os.RemoveAll(root)
}

func (in *Inproc) acceptLoop() {
	defer in.closers.Done()
	for {
		c, err := in.lis.Accept()
		if err != nil {
			return
		}
		kc := in.wrap(c)
		in.closers.Add(1)
		go func() {
			defer in.closers.Done()
			in.handle(kc)
		}()
	}
}

func (in *Inproc) wrap(c net.Conn) *killConn {
	in.mu.Lock()
	defer in.mu.Unlock()
	if in.closed {
		c.Close()
	}
	var threshold int64
	if len(in.queue) > 0 {
		threshold = in.queue[0]
		in.queue = in.queue[1:]
	}
	kc := newKillConn(c, threshold)
	in.active[kc] = struct{}{}
	in.conns++
	in.total++
	return kc
}

func (in *Inproc) handle(kc *killConn) {
	defer func() {
		kc.Close()
		in.mu.Lock()
		delete(in.active, kc)
		in.mu.Unlock()
	}()
	sconn, chans, reqs, err := ssh.NewServerConn(kc, in.cfg)
	if err != nil {
		return
	}
	defer sconn.Close()
	go ssh.DiscardRequests(reqs)
	for nch := range chans {
		if nch.ChannelType() != "session" {
			nch.Reject(ssh.UnknownChannelType, "only session channels")
			continue
		}
		// Channels must be handled concurrently: an SFTP subsystem
		// channel stays open while later exec sessions arrive on the
		// same connection.
		go in.handleSession(nch)
	}
}

func (in *Inproc) handleSession(nch ssh.NewChannel) {
	ch, reqs, err := nch.Accept()
	if err != nil {
		return
	}
	defer ch.Close()
	for req := range reqs {
		switch req.Type {
		case "exec":
			var payload struct{ Command string }
			if err := ssh.Unmarshal(req.Payload, &payload); err != nil {
				req.Reply(false, nil)
				continue
			}
			req.Reply(true, nil)
			in.runExec(ch, payload.Command)
			return
		case "subsystem":
			var payload struct{ Name string }
			if err := ssh.Unmarshal(req.Payload, &payload); err != nil || payload.Name != "sftp" {
				req.Reply(false, nil)
				continue
			}
			req.Reply(true, nil)
			srv, err := sftp.NewServer(ch)
			if err != nil {
				return
			}
			_ = srv.Serve()
			return
		default:
			if req.WantReply {
				req.Reply(false, nil)
			}
		}
	}
}

// execWhitelist bounds what the fixture exec channel can run.
var execWhitelist = map[string]bool{
	"dd": true, "truncate": true, "sha256sum": true,
	"mkdir": true, "rm": true, "chmod": true, "true": true,
}

func (in *Inproc) runExec(ch ssh.Channel, command string) {
	fields := strings.Fields(command)
	if len(fields) == 0 || !execWhitelist[fields[0]] {
		ch.Write([]byte("testssh: command not allowed\r\n"))
		sendExitStatus(ch, 126)
		return
	}
	cmd := exec.Command(fields[0], fields[1:]...)
	cmd.Dir = in.Root
	cmd.Stdout = ch
	cmd.Stderr = ch
	err := cmd.Run()
	code := 0
	if err != nil {
		code = 1
	}
	sendExitStatus(ch, code)
}

func sendExitStatus(ch ssh.Channel, code int) {
	payload := ssh.Marshal(struct{ Status uint32 }{uint32(code)})
	_, _ = ch.SendRequest("exit-status", false, payload)
}

// killConn wraps a conn and hard-closes it after `threshold`
// transferred bytes (0 = never kill). Bytes count both directions
// (requests and data), approximating the transfer offset.
type killConn struct {
	net.Conn
	threshold int64
	seen      atomic.Int64
	once      sync.Once
}

func newKillConn(c net.Conn, threshold int64) *killConn {
	return &killConn{Conn: c, threshold: threshold}
}

func (k *killConn) passed(n int) {
	if k.threshold <= 0 {
		return
	}
	if k.seen.Add(int64(n)) >= k.threshold {
		k.once.Do(k.hardClose)
	}
}

func (k *killConn) Read(b []byte) (int, error) {
	n, err := k.Conn.Read(b)
	k.passed(n)
	return n, err
}

func (k *killConn) Write(b []byte) (int, error) {
	n, err := k.Conn.Write(b)
	k.passed(n)
	return n, err
}

// hardClose aborts the TCP connection with RST where possible.
func (k *killConn) hardClose() {
	if tc, ok := k.Conn.(*net.TCPConn); ok {
		_ = tc.SetLinger(0)
	}
	_ = k.Conn.Close()
}
