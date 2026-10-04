// Package e2eharness boots the full Stratofold stack for browser E2E
// runs (design D7): the real embedded app server (appserver.Install)
// on a real HTTP port, backed by the in-process SSH/SFTP fixture
// (testssh.StartInproc) with a seeded dataset — users, connections,
// vdirs, files, a small media file, and a 10k-entry directory. It is
// the testing.TB-free counterpart of internal/testapp, so it can run
// from a command.
package e2eharness

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	// system migrations register the schema hooks a bare base app needs.
	_ "github.com/pocketbase/pocketbase/migrations"

	"github.com/mode777/stratofold/internal/appserver"
	"github.com/mode777/stratofold/internal/testssh"
)

// Credentials seeded for the E2E flows.
const (
	OwnerEmail    = "owner@stratofold.test"
	OwnerPassword = "owner-pass-123"
	// Grantee is the user a share is granted to in the sharing flow.
	GranteeEmail    = "grantee@stratofold.test"
	GranteePassword = "grantee-pass-123"

	// BigDirCount is the number of entries seeded under big/ to exercise
	// list virtualization in the browser.
	BigDirCount = 10000
)

// Stack is a running harness.
type Stack struct {
	App     core.App
	BaseURL string
	VdirID  string // owner's private vdir
	PubID   string // public vdir

	fixture *testssh.Inproc
}

// Start boots the SSH fixture and the app server, seeds the dataset,
// and returns the running stack. The caller owns Close. addr is the
// HTTP listen address ("" binds 127.0.0.1 on a random port).
func Start(dataDir, addr string) (*Stack, error) {
	fixture, err := testssh.StartInproc()
	if err != nil {
		return nil, fmt.Errorf("e2eharness: ssh fixture: %w", err)
	}

	if addr == "" {
		addr = "127.0.0.1:0"
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fixture.Close()
		return nil, fmt.Errorf("e2eharness: listener: %w", err)
	}

	app := core.NewBaseApp(core.BaseAppConfig{
		DataDir:      dataDir,
		QueryTimeout: core.DefaultQueryTimeout,
	})
	appserver.Install(app, appserver.Options{DataDir: dataDir, Listener: ln})

	if err := app.Bootstrap(); err != nil {
		ln.Close()
		fixture.Close()
		return nil, fmt.Errorf("e2eharness: bootstrap: %w", err)
	}

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- apis.Serve(app, apis.ServeConfig{
			HttpAddr:        ln.Addr().String(),
			ShowStartBanner: false,
		})
	}()

	baseURL := "http://" + ln.Addr().String()
	if err := waitForHealth(baseURL); err != nil {
		ln.Close()
		fixture.Close()
		return nil, err
	}

	s := &Stack{App: app, BaseURL: baseURL, fixture: fixture}
	if err := s.seed(dataDir); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}

// Close tears the stack down.
func (s *Stack) Close() {
	if s.fixture != nil {
		s.fixture.Close()
	}
	if s.App != nil {
		te := new(core.TerminateEvent)
		te.App = s.App
		_ = s.App.OnTerminate().Trigger(te, func(e *core.TerminateEvent) error {
			return e.App.ClearBootstrap()
		})
	}
}

func waitForHealth(baseURL string) error {
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Get(baseURL + "/api/health")
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("e2eharness: server did not become healthy at %s", baseURL)
}

// seed creates the users, the connection to the fixture, the vdirs, and
// the on-disk dataset (the in-proc SFTP server serves the fixture root
// directly, so files are written with the os package).
func (s *Stack) seed(_ string) error {
	users, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		return fmt.Errorf("e2eharness: users collection: %w", err)
	}
	mkUser := func(email, password string) (*core.Record, error) {
		rec := core.NewRecord(users)
		rec.SetEmail(email)
		rec.SetPassword(password)
		if err := s.App.Save(rec); err != nil {
			return nil, err
		}
		return rec, nil
	}
	owner, err := mkUser(OwnerEmail, OwnerPassword)
	if err != nil {
		return fmt.Errorf("e2eharness: owner: %w", err)
	}
	if _, err := mkUser(GranteeEmail, GranteePassword); err != nil {
		return fmt.Errorf("e2eharness: grantee: %w", err)
	}

	root := filepath.Join(s.fixture.Root, "srv")
	if err := seedDataset(root); err != nil {
		return fmt.Errorf("e2eharness: dataset: %w", err)
	}

	connections, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		return fmt.Errorf("e2eharness: connections collection: %w", err)
	}
	conn := core.NewRecord(connections)
	conn.Set("owner", owner.Id)
	conn.Set("label", "fixture")
	conn.Set("host", "127.0.0.1")
	conn.Set("port", s.fixture.Port())
	conn.Set("username", s.fixture.User)
	conn.Set("auth_method", "password")
	conn.Set("password", s.fixture.Password)
	conn.Set("host_key_fingerprint", s.fixture.Fingerprint())
	// The remote directory is the connection's default vdir root; the
	// seeded vdirs below use it so the browser prefill path is exercised
	// against the same value.
	conn.Set("remote_dir", root)
	if err := s.App.Save(conn); err != nil {
		return fmt.Errorf("e2eharness: save connection: %w", err)
	}

	vdirs, err := s.App.FindCollectionByNameOrId("vdirs")
	if err != nil {
		return fmt.Errorf("e2eharness: vdirs collection: %w", err)
	}
	mkVdir := func(name string, public bool) (*core.Record, error) {
		vd := core.NewRecord(vdirs)
		vd.Set("owner", owner.Id)
		vd.Set("connection", conn.Id)
		vd.Set("name", name)
		vd.Set("root_path", conn.GetString("remote_dir"))
		vd.Set("is_public", public)
		if err := s.App.Save(vd); err != nil {
			return nil, err
		}
		return vd, nil
	}
	home, err := mkVdir("Home", false)
	if err != nil {
		return fmt.Errorf("e2eharness: home vdir: %w", err)
	}
	pub, err := mkVdir("Public", true)
	if err != nil {
		return fmt.Errorf("e2eharness: public vdir: %w", err)
	}
	s.VdirID = home.Id
	s.PubID = pub.Id
	return nil
}

// seedDataset writes the E2E files under root: a text file, a small
// media file, a docs/ subdirectory, and a big/ directory with
// BigDirCount entries (list virtualization).
func seedDataset(root string) error {
	for _, dir := range []string{root, filepath.Join(root, "docs"), filepath.Join(root, "big")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("hello stratofold\n"), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(root, "docs", "readme.md"), []byte("# docs\n"), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(root, "movie.mp4"), minimalMP4(), 0o644); err != nil {
		return err
	}
	for i := 0; i < BigDirCount; i++ {
		name := filepath.Join(root, "big", "file-"+pad(i)+".txt")
		if err := os.WriteFile(name, []byte(strconv.Itoa(i)), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func pad(i int) string {
	s := strconv.Itoa(i)
	for len(s) < 5 {
		s = "0" + s
	}
	return s
}

// minimalMP4 is a structurally minimal ISO-BMFF file: a valid ftyp box
// followed by a small mdat. Browsers fetch the resource (Range
// requests) when a media URL is opened; playback itself is not part of
// the assertion.
func minimalMP4() []byte {
	ftyp := []byte{
		0x00, 0x00, 0x00, 0x18, 'f', 't', 'y', 'p',
		'i', 's', 'o', 'm', 0x00, 0x00, 0x02, 0x00,
		'i', 's', 'o', 'm', 'i', 's', 'o', '2',
	}
	payload := []byte("stratofold e2e media payload")
	mdat := []byte{
		0x00, 0x00, 0x00, byte(8 + len(payload)), 'm', 'd', 'a', 't',
	}
	mdat = append(mdat, payload...)
	return append(ftyp, mdat...)
}

// BaseURLOf returns the stack's base URL (helper for callers).
func (s *Stack) BaseURLOf() string { return s.BaseURL }
