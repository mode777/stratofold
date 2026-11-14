package fsapi

import (
	"errors"
	"io"
	"testing"

	"github.com/pkg/sftp"
	"github.com/pocketbase/pocketbase/core"

	// Register the system + app migrations (file_versions included).
	_ "github.com/pocketbase/pocketbase/migrations"

	"github.com/mode777/stratofold/internal/fileversion"
	_ "github.com/mode777/stratofold/internal/migrations"
	"github.com/mode777/stratofold/internal/testssh"
)

// TestRecordMovedTargetIsBestEffort injects a bump failure by using an
// app without the file_versions collection: the helper must log and
// return, never turn a completed mv into a failed request.
func TestRecordMovedTargetIsBestEffort(t *testing.T) {
	app := core.NewBaseApp(core.BaseAppConfig{DataDir: t.TempDir()})
	if err := app.Bootstrap(); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	defer func() { _ = app.ClearBootstrap() }()

	recordMovedTarget(app, "vdir", "/srv/data/moved.txt")
}

func newMigratedApp(t *testing.T) core.App {
	t.Helper()
	app := core.NewBaseApp(core.BaseAppConfig{
		DataDir:      t.TempDir(),
		QueryTimeout: core.DefaultQueryTimeout,
	})
	if err := app.Bootstrap(); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if err := app.RunAllMigrations(); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	t.Cleanup(func() {
		te := new(core.TerminateEvent)
		te.App = app
		_ = app.OnTerminate().Trigger(te, func(e *core.TerminateEvent) error {
			return e.App.ClearBootstrap()
		})
	})
	return app
}

func newFixtureClient(t *testing.T) (*testssh.Fixture, *sftp.Client) {
	t.Helper()
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	t.Cleanup(f.Close)
	cl, err := f.SSHClient()
	if err != nil {
		t.Fatal(err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = scl.Close() })
	return f, scl
}

func writeBytes(t *testing.T, scl *sftp.Client, path, content string) {
	t.Helper()
	fp, err := scl.Create(path)
	if err != nil {
		t.Fatalf("create %s: %v", path, err)
	}
	if _, err := fp.Write([]byte(content)); err != nil {
		_ = fp.Close()
		t.Fatalf("write %s: %v", path, err)
	}
	if err := fp.Close(); err != nil {
		t.Fatalf("close %s: %v", path, err)
	}
}

func publisherFixture(t *testing.T, app core.App, scl *sftp.Client, root, name, targetContent, tempContent string) (string, string, targetState) {
	t.Helper()
	if err := scl.MkdirAll(root); err != nil {
		t.Fatal(err)
	}
	target := root + "/" + name
	temp := root + "/." + name + ".sfpart-test"
	writeBytes(t, scl, target, targetContent)
	writeBytes(t, scl, temp, tempContent)
	pre, err := statTarget(app, "vdir", "", target, scl)
	if err != nil {
		t.Fatalf("pre stat: %v", err)
	}
	return target, temp, pre
}

func TestPublisherRetryFinishesItsOwnReservation(t *testing.T) {
	app := newMigratedApp(t)
	f, scl := newFixtureClient(t)
	target, temp, pre := publisherFixture(t, app, scl, f.Path("publisher-a"), "a.txt", "old", "new")

	gen, err := fileversion.Bump(app, "vdir", target)
	if err != nil {
		t.Fatal(err)
	}
	p := &conditionalPublisher{
		app:      app,
		vdirID:   "vdir",
		target:   target,
		temp:     temp,
		im:       ifMatch{present: true, tags: []string{pre.version}},
		reserved: gen,
		pre:      pre,
	}
	if err := p.publish(scl); err != nil {
		t.Fatalf("retry of own reservation: %v", err)
	}
	if !p.published {
		t.Fatal("publisher did not record publication")
	}
	if got := readBytes(t, scl, target); got != "new" {
		t.Fatalf("target = %q, want new", got)
	}
}

func TestPublisherRetryRejectsSupersededReservation(t *testing.T) {
	app := newMigratedApp(t)
	f, scl := newFixtureClient(t)
	target, temp, pre := publisherFixture(t, app, scl, f.Path("publisher-b"), "b.txt", "old", "new")

	gen, err := fileversion.Bump(app, "vdir", target)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fileversion.Bump(app, "vdir", target); err != nil { // another writer
		t.Fatal(err)
	}
	p := &conditionalPublisher{
		app:      app,
		vdirID:   "vdir",
		target:   target,
		temp:     temp,
		im:       ifMatch{present: true, tags: []string{pre.version}},
		reserved: gen,
		pre:      pre,
	}
	err = p.publish(scl)
	var conflict *preconditionError
	if !errors.As(err, &conflict) {
		t.Fatalf("superseded reservation error = %v, want precondition", err)
	}
	if _, statErr := scl.Stat(temp); statErr != nil {
		t.Fatalf("publisher removed the temp before the caller could: %v", statErr)
	}
}

func TestPublisherRetryRejectsChangedSignature(t *testing.T) {
	app := newMigratedApp(t)
	f, scl := newFixtureClient(t)
	target, temp, pre := publisherFixture(t, app, scl, f.Path("publisher-c"), "c.txt", "old", "new")

	gen, err := fileversion.Bump(app, "vdir", target)
	if err != nil {
		t.Fatal(err)
	}
	writeBytes(t, scl, target, "changed-externally") // same path, different signature
	p := &conditionalPublisher{
		app:      app,
		vdirID:   "vdir",
		target:   target,
		temp:     temp,
		im:       ifMatch{present: true, tags: []string{pre.version}},
		reserved: gen,
		pre:      pre,
	}
	err = p.publish(scl)
	var conflict *preconditionError
	if !errors.As(err, &conflict) {
		t.Fatalf("changed-signature error = %v, want precondition", err)
	}
	if got := readBytes(t, scl, target); got != "changed-externally" {
		t.Fatalf("target = %q, want external content", got)
	}
}

func readBytes(t *testing.T, scl *sftp.Client, path string) string {
	t.Helper()
	fp, err := scl.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer fp.Close()
	data, err := io.ReadAll(fp)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}
