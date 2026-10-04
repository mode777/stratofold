package sshconn

import (
	"context"
	"fmt"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"

	"github.com/mode777/stratofold/internal/ssherr"
)

// State of the managed connection.
type State int

const (
	// StateNoConn: no connection established (initial or evicted).
	StateNoConn State = iota
	// StateHealthy: a connection is established and usable.
	StateHealthy
	// StateReconnecting: the connection failed; re-dials are in
	// backoff.
	StateReconnecting
	// StateClosed: the manager is closed.
	StateClosed
)

func (s State) String() string {
	switch s {
	case StateNoConn:
		return "no-conn"
	case StateHealthy:
		return "healthy"
	case StateReconnecting:
		return "reconnecting"
	default:
		return "closed"
	}
}

// Release must be called when the returned client is no longer used.
type Release func()

// ClientProvider is the seam the operation layer consumes. The manager
// implements it; later pooling swaps in behind it.
type ClientProvider interface {
	// Client returns a usable SFTP client, dialing/reconnecting (with
	// backoff) as needed. The returned Release decrements the in-use
	// refcount and must be called exactly once.
	Client(ctx context.Context) (*sftp.Client, Release, error)
	// Invalidate marks the client broken (retryable failure observed
	// through it) and drops the connection.
	Invalidate(c *sftp.Client)
}

// Manager owns the lifecycle of one SSH/SFTP connection per Config:
// dial on demand, idle-TTL eviction, exponential-backoff reconnect,
// pinned host keys.
type Manager struct {
	cfg   Config
	clock Clock

	mu       sync.Mutex
	cl       *sftp.Client
	sshCl    *ssh.Client
	refs     int
	lastUsed time.Time
	state    State
	bk       *Backoff
	closed   bool
	dialing  bool
	dialDone chan struct{}

	dialHook func()
	connWrap func(net.Conn) net.Conn

	stopOnce sync.Once
	stop     chan struct{}
}

// Option customizes a Manager (mostly for tests).
type Option func(*Manager)

// WithClock overrides the clock (tests inject a FakeClock).
func WithClock(c Clock) Option { return func(m *Manager) { m.clock = c } }

// WithDialHook registers a callback invoked on every dial attempt.
func WithDialHook(fn func()) Option { return func(m *Manager) { m.dialHook = fn } }

// WithConnWrap wraps each new underlying net.Conn (test chaos hooks:
// kill connections at byte thresholds).
func WithConnWrap(fn func(net.Conn) net.Conn) Option {
	return func(m *Manager) { m.connWrap = fn }
}

// NewManager validates cfg and returns a manager for it.
func NewManager(cfg Config, opts ...Option) (*Manager, error) {
	if cfg.Host == "" || cfg.User == "" {
		return nil, fmt.Errorf("sshconn: host and user are required")
	}
	if cfg.HostKeyFingerprint == "" {
		return nil, fmt.Errorf("sshconn: pinned host key fingerprint is required")
	}
	if err := validateFingerprint(cfg.HostKeyFingerprint); err != nil {
		return nil, err
	}
	if cfg.Password == "" && len(cfg.PrivateKeyPEM) == 0 {
		return nil, fmt.Errorf("sshconn: one of password or private key is required")
	}
	cfg.withDefaults()

	m := &Manager{
		cfg:   cfg,
		clock: RealClock(),
		state: StateNoConn,
		bk:    NewBackoff(cfg.Backoff, nil),
		stop:  make(chan struct{}),
	}
	for _, o := range opts {
		o(m)
	}
	go m.idleWatchdog()
	return m, nil
}

// Config returns a copy of the manager's configuration.
func (m *Manager) Config() Config { return m.cfg }

// Key identifies the managed connection.
func (m *Manager) Key() string { return m.cfg.key() }

// State reports the current lifecycle state.
func (m *Manager) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

// Client implements ClientProvider.
func (m *Manager) Client(ctx context.Context) (*sftp.Client, Release, error) {
	for {
		m.mu.Lock()
		if m.closed {
			m.mu.Unlock()
			return nil, nil, fmt.Errorf("sshconn: manager closed")
		}
		if m.cl != nil {
			m.refs++
			m.lastUsed = m.clock.Now()
			cl := m.cl
			m.mu.Unlock()
			return cl, m.release, nil
		}
		if m.dialing {
			// Exactly one goroutine dials; the rest wait for its
			// outcome and then re-check (they either find a healthy
			// connection or take over dialing themselves).
			ch := m.dialDone
			m.mu.Unlock()
			select {
			case <-ctx.Done():
				return nil, nil, ctx.Err()
			case <-ch:
			}
			continue
		}
		m.dialing = true
		m.dialDone = make(chan struct{})
		m.state = StateReconnecting
		m.mu.Unlock()

		_, err := m.dialLoop(ctx)

		m.mu.Lock()
		m.dialing = false
		close(m.dialDone)
		cl := m.cl
		m.mu.Unlock()

		if err != nil {
			return nil, nil, err
		}
		if cl != nil {
			m.refs++
			m.lastUsed = m.clock.Now()
			return cl, m.release, nil
		}
		// Spuriously no client (e.g. raced with Close): loop.
	}
}

// dialLoop owns the dial attempts (with backoff between retryable
// failures) until success, a permanent error, or context end. On
// success it installs the client and takes one ref.
func (m *Manager) dialLoop(ctx context.Context) (*sftp.Client, error) {
	for {
		cl, err := m.dial(ctx)
		if err == nil {
			m.mu.Lock()
			m.cl = cl
			m.refs = 0 // the caller in Client() takes the first ref
			m.lastUsed = m.clock.Now()
			m.state = StateHealthy
			m.bk.Reset()
			m.mu.Unlock()
			return cl, nil
		}
		if ssherr.IsPermanent(err) {
			m.mu.Lock()
			m.state = StateNoConn
			m.mu.Unlock()
			return nil, err
		}
		// Retryable: wait out the backoff (or the context).
		m.mu.Lock()
		delay := m.bk.Next()
		m.mu.Unlock()
		if !m.sleep(ctx, delay) {
			m.mu.Lock()
			m.state = StateNoConn
			m.mu.Unlock()
			return nil, ctx.Err()
		}
	}
}

// Invalidate implements ClientProvider: it drops the connection so the
// next Client call re-establishes it.
func (m *Manager) Invalidate(c *sftp.Client) {
	m.mu.Lock()
	if m.closed || c == nil || c != m.cl {
		m.mu.Unlock()
		return
	}
	m.cl = nil
	m.state = StateReconnecting
	sshCl := m.takeSSH()
	m.mu.Unlock()
	if sshCl != nil {
		sshCl.Close() // best effort
	}
}

// takeSSH detaches the ssh.Client handle (caller closes it).
func (m *Manager) takeSSH() *ssh.Client {
	c := m.sshCl
	m.sshCl = nil
	return c
}

// Close closes the manager and any live connection.
func (m *Manager) Close() error {
	m.stopOnce.Do(func() { close(m.stop) })
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil
	}
	m.closed = true
	m.state = StateClosed
	var err error
	if m.sshCl != nil {
		err = m.sshCl.Close()
		m.sshCl = nil
	}
	m.cl = nil
	return err
}

// dial establishes the SSH connection and opens the SFTP subsystem.
func (m *Manager) dial(ctx context.Context) (*sftp.Client, error) {
	if m.dialHook != nil {
		m.dialHook()
	}
	addr := net.JoinHostPort(m.cfg.Host, strconv.Itoa(m.cfg.Port))
	d := net.Dialer{Timeout: m.cfg.DialTimeout}
	nc, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("sshconn: dial %s: %w", addr, err)
	}
	if m.connWrap != nil {
		nc = m.connWrap(nc)
	}
	sconn, chans, reqs, err := ssh.NewClientConn(nc, addr, m.sshClientConfig())
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("sshconn: ssh handshake %s: %w", addr, err)
	}
	client := ssh.NewClient(sconn, chans, reqs)
	opts := []sftp.ClientOption{}
	if m.cfg.SFTPMaxPacket > 0 {
		opts = append(opts, sftp.MaxPacket(m.cfg.SFTPMaxPacket))
	}
	scl, err := sftp.NewClient(client, opts...)
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("sshconn: open sftp channel: %w", err)
	}
	m.mu.Lock()
	m.sshCl = client
	m.mu.Unlock()
	return scl, nil
}

func (m *Manager) sshClientConfig() *ssh.ClientConfig {
	auth := make([]ssh.AuthMethod, 0, 3)
	if m.cfg.Password != "" {
		auth = append(auth, ssh.Password(m.cfg.Password))
	}
	if len(m.cfg.PrivateKeyPEM) > 0 {
		var signer ssh.Signer
		var err error
		if m.cfg.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(m.cfg.PrivateKeyPEM, []byte(m.cfg.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey(m.cfg.PrivateKeyPEM)
		}
		if err == nil {
			auth = append(auth, ssh.PublicKeys(signer))
		}
	}
	if m.cfg.Password != "" {
		pw := m.cfg.Password
		auth = append(auth, ssh.KeyboardInteractive(func(name, instruction string, questions []string, echos []bool) ([]string, error) {
			answers := make([]string, len(questions))
			for i := range questions {
				answers[i] = pw
			}
			return answers, nil
		}))
	}
	fp := m.cfg.HostKeyFingerprint
	return &ssh.ClientConfig{
		User: m.cfg.User,
		Auth: auth,
		HostKeyCallback: func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			got := Fingerprint(key)
			if got != fp {
				return ssherr.HostKeyMismatch(got, fp)
			}
			return nil
		},
		Timeout: m.cfg.DialTimeout,
	}
}

func (m *Manager) release() {
	m.mu.Lock()
	m.refs--
	m.lastUsed = m.clock.Now()
	m.mu.Unlock()
}

func (m *Manager) sleep(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return ctx.Err() == nil
	}
	t := m.clock.After(d)
	select {
	case <-ctx.Done():
		return false
	case <-t:
		return true
	}
}

// idleWatchdog evicts connections idle longer than the TTL while they
// have no users.
func (m *Manager) idleWatchdog() {
	tick := m.cfg.IdleTTL / 4
	if tick <= 0 {
		tick = time.Second
	}
	for {
		select {
		case <-m.stop:
			return
		case <-m.clock.After(tick):
		}
		m.mu.Lock()
		if m.closed || m.sshCl == nil || m.refs > 0 ||
			m.clock.Now().Sub(m.lastUsed) < m.cfg.IdleTTL {
			m.mu.Unlock()
			continue
		}
		sshCl := m.takeSSH()
		m.cl = nil
		m.state = StateNoConn
		m.mu.Unlock()
		if sshCl != nil {
			sshCl.Close()
		}
	}
}
