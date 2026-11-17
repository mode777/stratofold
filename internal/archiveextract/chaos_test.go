package archiveextract

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/testssh"
)

// TestExtractSurvivesConnectionDrops kills the connection at several byte
// thresholds during one extraction and requires the published tree to be
// byte-identical to a clean extraction.
func TestExtractSurvivesConnectionDrops(t *testing.T) {
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	defer f.Close()

	kill := testssh.NewKillSwitch(200<<10, 500<<10, 900<<10, 1400<<10)
	mgr, err := f.NewManager(sshconn.WithConnWrap(kill.Wrap()))
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	defer mgr.Close()

	files := map[string]string{}
	for i := 0; i < 60; i++ {
		files[fmt.Sprintf("d%d/f%d.txt", i%6, i)] = strings.Repeat("payload-", 512)
	}
	archive := buildZip(t, files)
	e := &fixtureEnv{f: f, mgr: mgr, dir: f.Path("chaos")}
	mustMkdir(t, e, "chaos")
	e.put(t, "many.zip", archive)

	snap := runRequest(t, e, "many.zip", "many")
	if snap.State != StateSucceeded {
		t.Fatalf("state = %s (%+v)", snap.State, snap.Error)
	}
	for name, want := range files {
		got, err := e.read(t, "many/"+name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if string(got) != want {
			t.Fatalf("%s: content differs after reconnect (len %d vs %d)", name, len(got), len(want))
		}
	}
}

func mustMkdir(t *testing.T, e *fixtureEnv, rel string) {
	t.Helper()
	cl, release, err := e.mgr.Client(context.Background())
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	defer release()
	if err := cl.MkdirAll(e.f.Path(rel)); err != nil {
		t.Fatalf("mkdir %s: %v", rel, err)
	}
}

// TestExtractArchiveShapes covers the format corners: stored-only
// members, an empty archive, a single top-level directory (not
// flattened), zero-byte members, and a hand-built zip64 archive.
func TestExtractArchiveShapes(t *testing.T) {
	t.Run("stored members", func(t *testing.T) {
		e, done := startEnv(t)
		defer done()
		e.put(t, "stored.zip", buildStoredZip(t, map[string]string{"a.txt": "alpha", "b/c.txt": "beta"}))
		snap := runRequest(t, e, "stored.zip", "stored")
		if snap.State != StateSucceeded {
			t.Fatalf("state = %s (%+v)", snap.State, snap.Error)
		}
		got, err := e.read(t, "stored/b/c.txt")
		if err != nil || string(got) != "beta" {
			t.Fatalf("b/c.txt = %q, %v", got, err)
		}
	})

	t.Run("empty archive is not an empty success", func(t *testing.T) {
		e, done := startEnv(t)
		defer done()
		e.put(t, "empty.zip", buildZip(t, map[string]string{}))
		snap := runRequest(t, e, "empty.zip", "empty")
		if snap.State != StateFailed {
			t.Fatalf("state = %s (%+v), want failed", snap.State, snap.Error)
		}
		if snap.Error == nil || !strings.Contains(snap.Error.Message, "nothing could be extracted") {
			t.Fatalf("error = %+v, want the nothing-extracted wording", snap.Error)
		}
		if names := e.list(t); contains(names, "empty") {
			t.Fatalf("empty folder published: %v", names)
		}
	})

	t.Run("single top-level directory is not flattened", func(t *testing.T) {
		e, done := startEnv(t)
		defer done()
		e.put(t, "photos.zip", buildZip(t, map[string]string{"photos/a.jpg": "aaa"}))
		snap := runRequest(t, e, "photos.zip", "photos")
		if snap.State != StateSucceeded {
			t.Fatalf("state = %s (%+v)", snap.State, snap.Error)
		}
		if _, err := e.read(t, "photos/photos/a.jpg"); err != nil {
			t.Fatalf("nested folder missing: %v", err)
		}
	})

	t.Run("zip64 archive", func(t *testing.T) {
		e, done := startEnv(t)
		defer done()
		e.put(t, "z64.zip", buildZip64(t, "big.txt", []byte("zip64 payload")))
		snap := runRequest(t, e, "z64.zip", "z64")
		if snap.State != StateSucceeded {
			t.Fatalf("state = %s (%+v)", snap.State, snap.Error)
		}
		got, err := e.read(t, "z64/big.txt")
		if err != nil || string(got) != "zip64 payload" {
			t.Fatalf("big.txt = %q, %v", got, err)
		}
	})
}

// TestExtractRegistriesAreIndependent documents the restart boundary: job
// state is process-local, so a fresh registry knows nothing about an
// earlier job, and a canceled job leaves nothing published.
func TestExtractRegistriesAreIndependent(t *testing.T) {
	e, done := startEnv(t)
	defer done()
	e.put(t, "photos.zip", buildZip(t, map[string]string{"a.txt": "a"}))

	first := NewRegistry()
	entered := make(chan struct{}, 1)
	j, err := Start(context.Background(), first, Request{
		VdirID:        "v1",
		Path:          "photos.zip",
		Target:        "photos",
		ArchiveRemote: e.dir + "/photos.zip",
		ArchiveSize:   int64(len(buildZip(t, map[string]string{"a.txt": "a"}))),
		DirRemote:     e.dir,
		TargetName:    "photos",
		Provider:      e.mgr,
		Authorize: func(c context.Context) error {
			select {
			case entered <- struct{}{}:
			default:
			}
			<-c.Done()
			return c.Err()
		},
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	<-entered

	second := NewRegistry()
	if _, ok := second.Lookup("v1", j.id); ok {
		t.Fatal("a fresh registry must not know another registry's jobs")
	}
	if _, ok := first.Cancel(context.Background(), "v1", j.id, 10*time.Second); !ok {
		t.Fatal("cancel must resolve in the owning registry")
	}
	assertNothingPublished(t, e, "photos")
}

// buildStoredZip builds an archive with stored (uncompressed) members.
func buildStoredZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, name := range sortedKeys(files) {
		h := &zip.FileHeader{Name: name, Method: zip.Store}
		fw, err := w.CreateHeader(h)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		if _, err := fw.Write([]byte(files[name])); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	return buf.Bytes()
}
