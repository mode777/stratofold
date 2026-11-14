package fileversion_test

import (
	"os"
	"testing"
	"time"

	"github.com/mode777/stratofold/internal/fileversion"
	"github.com/mode777/stratofold/internal/testapp"
)

type fakeInfo struct {
	name string
	size int64
	mode os.FileMode
	mod  time.Time
}

func (f fakeInfo) Name() string       { return f.name }
func (f fakeInfo) Size() int64        { return f.size }
func (f fakeInfo) Mode() os.FileMode  { return f.mode }
func (f fakeInfo) ModTime() time.Time { return f.mod }
func (f fakeInfo) IsDir() bool        { return f.mode.IsDir() }
func (f fakeInfo) Sys() any           { return nil }

func fileInfo() os.FileInfo {
	return fakeInfo{name: "a.txt", size: 12, mode: 0o644, mod: time.Unix(1_700_000_000, 0)}
}

func TestHashIsDeterministicAndSensitive(t *testing.T) {
	base := fileversion.Hash("vdir", "conn", "/data/a.txt", fileInfo(), 0)
	if again := fileversion.Hash("vdir", "conn", "/data/a.txt", fileInfo(), 0); again != base {
		t.Fatalf("hash is not deterministic: %q != %q", again, base)
	}
	cases := map[string]string{
		"vdir":       fileversion.Hash("other", "conn", "/data/a.txt", fileInfo(), 0),
		"connection": fileversion.Hash("vdir", "other", "/data/a.txt", fileInfo(), 0),
		"path":       fileversion.Hash("vdir", "conn", "/data/b.txt", fileInfo(), 0),
		"generation": fileversion.Hash("vdir", "conn", "/data/a.txt", fileInfo(), 1),
		"directory":  fileversion.Hash("vdir", "conn", "/data/a.txt", fakeInfo{name: "a.txt", mode: os.ModeDir | 0o755, mod: time.Unix(1_700_000_000, 0)}, 0),
		"size":       fileversion.Hash("vdir", "conn", "/data/a.txt", fakeInfo{name: "a.txt", size: 13, mode: 0o644, mod: time.Unix(1_700_000_000, 0)}, 0),
		"mtime":      fileversion.Hash("vdir", "conn", "/data/a.txt", fakeInfo{name: "a.txt", size: 12, mode: 0o644, mod: time.Unix(1_700_000_001, 0)}, 0),
	}
	for name, got := range cases {
		if got == base {
			t.Errorf("version did not change when %s changed", name)
		}
	}
	if base[:3] != "v1-" {
		t.Fatalf("version %q lacks the v1- prefix", base)
	}
}

func TestVersionChangesOnlyOnBumpOrSignature(t *testing.T) {
	s := testapp.Start(t)

	first, err := fileversion.Version(s.App, "vdir", "conn", "/data/a.txt", fileInfo())
	if err != nil {
		t.Fatal(err)
	}
	second, err := fileversion.Version(s.App, "vdir", "conn", "/data/a.txt", fileInfo())
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("unchanged path version changed: %q -> %q", first, second)
	}

	gen, err := fileversion.Bump(s.App, "vdir", "/data/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if gen != 1 {
		t.Fatalf("first bump generation = %d, want 1", gen)
	}
	after, err := fileversion.Version(s.App, "vdir", "conn", "/data/a.txt", fileInfo())
	if err != nil {
		t.Fatal(err)
	}
	if after == first {
		t.Fatalf("bump did not change the version: %q", after)
	}

	gen, err = fileversion.Bump(s.App, "vdir", "/data/a.txt")
	if err != nil || gen != 2 {
		t.Fatalf("second bump = %d, %v, want 2, nil", gen, err)
	}
	if err := fileversion.Rollback(s.App, "vdir", "/data/a.txt", 1); err != nil {
		t.Fatal(err)
	}
	stillTwo, err := fileversion.Generation(s.App, "vdir", "/data/a.txt")
	if err != nil || stillTwo != 2 {
		t.Fatalf("rollback with a stale reservation changed generation: %d, %v", stillTwo, err)
	}
	if err := fileversion.Rollback(s.App, "vdir", "/data/a.txt", 2); err != nil {
		t.Fatal(err)
	}
	back, err := fileversion.Version(s.App, "vdir", "conn", "/data/a.txt", fileInfo())
	if err != nil {
		t.Fatal(err)
	}
	if back != after {
		t.Fatalf("rollback did not restore the prior version: %q != %q", back, after)
	}
}

func TestGenerationDefaultsAndBatchLookup(t *testing.T) {
	s := testapp.Start(t)

	if gen, err := fileversion.Generation(s.App, "vdir", "/data/missing"); err != nil || gen != 0 {
		t.Fatalf("untracked generation = %d, %v, want 0, nil", gen, err)
	}
	if _, err := fileversion.Bump(s.App, "vdir", "/data/a.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := fileversion.Bump(s.App, "vdir", "/data/a.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := fileversion.Bump(s.App, "vdir", "/data/b.txt"); err != nil {
		t.Fatal(err)
	}

	gens, err := fileversion.GenerationsForPaths(s.App, "vdir", []string{"/data/a.txt", "/data/b.txt", "/data/missing"})
	if err != nil {
		t.Fatal(err)
	}
	if gens["/data/a.txt"] != 2 || gens["/data/b.txt"] != 1 {
		t.Fatalf("batch generations = %#v", gens)
	}
	if _, ok := gens["/data/missing"]; ok {
		t.Fatalf("missing path appeared in batch: %#v", gens)
	}

	versions, err := fileversion.VersionsForDir(s.App, "vdir", "conn", "/data", []fileversion.Entry{
		{Name: "a.txt", Info: fileInfo()},
		{Name: "b.txt", Info: fakeInfo{name: "b.txt", size: 3, mode: 0o644, mod: time.Unix(1_700_000_000, 0)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if versions["a.txt"] == "" || versions["b.txt"] == "" || versions["a.txt"] == versions["b.txt"] {
		t.Fatalf("directory versions = %#v", versions)
	}
	if got := fileversion.JoinRemote("", "root.txt"); got != "/root.txt" {
		t.Fatalf("JoinRemote(root) = %q", got)
	}
}
