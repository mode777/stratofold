package archiveextract

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"

	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/testssh"
)

// fixtureEnv is a remote directory tree plus a manager on the in-proc
// SSH fixture.
type fixtureEnv struct {
	f   *testssh.Fixture
	mgr *sshconn.Manager
	dir string
}

func startEnv(t *testing.T) (*fixtureEnv, func()) {
	t.Helper()
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	mgr, err := f.NewManager()
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	cl, err := f.SSHClient()
	if err != nil {
		t.Fatalf("ssh: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp: %v", err)
	}
	dir := f.Path("extract")
	if err := scl.MkdirAll(dir); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	_ = scl.Close()
	return &fixtureEnv{f: f, mgr: mgr, dir: dir}, func() {
		_ = mgr.Close()
		f.Close()
	}
}

func (e *fixtureEnv) put(t *testing.T, rel string, data []byte) string {
	t.Helper()
	cl, err := e.f.SSHClient()
	if err != nil {
		t.Fatalf("ssh: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp: %v", err)
	}
	defer scl.Close()
	p := e.dir + "/" + rel
	if err := scl.MkdirAll(pathDir(p)); err != nil {
		t.Fatalf("mkdir %s: %v", rel, err)
	}
	fh, err := scl.Create(p)
	if err != nil {
		t.Fatalf("create %s: %v", rel, err)
	}
	if _, err := fh.Write(data); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
	if err := fh.Close(); err != nil {
		t.Fatalf("close %s: %v", rel, err)
	}
	return p
}

func (e *fixtureEnv) list(t *testing.T) []string {
	t.Helper()
	cl, err := e.f.SSHClient()
	if err != nil {
		t.Fatalf("ssh: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp: %v", err)
	}
	defer scl.Close()
	entries, err := scl.ReadDir(e.dir)
	if err != nil {
		t.Fatalf("readdir: %v", err)
	}
	out := make([]string, 0, len(entries))
	for _, en := range entries {
		out = append(out, en.Name())
	}
	return out
}

func (e *fixtureEnv) read(t *testing.T, rel string) ([]byte, error) {
	t.Helper()
	cl, err := e.f.SSHClient()
	if err != nil {
		t.Fatalf("ssh: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp: %v", err)
	}
	defer scl.Close()
	fh, err := scl.Open(e.dir + "/" + rel)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	return io.ReadAll(fh)
}

func pathDir(p string) string {
	i := strings.LastIndex(p, "/")
	if i < 0 {
		return "."
	}
	return p[:i]
}

func runRequest(t *testing.T, e *fixtureEnv, archiveRel, target string, opts ...func(*Request)) Snapshot {
	t.Helper()
	archive := e.dir + "/" + archiveRel
	cl, err := e.f.SSHClient()
	if err != nil {
		t.Fatalf("ssh: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp: %v", err)
	}
	fi, err := scl.Stat(archive)
	_ = scl.Close()
	if err != nil {
		t.Fatalf("stat archive: %v", err)
	}
	req := Request{
		VdirID:        "v1",
		Path:          archiveRel,
		Target:        target,
		ArchiveRemote: archive,
		ArchiveSize:   fi.Size(),
		DirRemote:     e.dir,
		TargetName:    target,
		Provider:      e.mgr,
	}
	for _, o := range opts {
		o(&req)
	}
	reg := NewRegistry()
	j, err := Start(context.Background(), reg, req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	select {
	case <-j.Done():
	case <-time.After(30 * time.Second):
		t.Fatal("extraction timed out")
	}
	return j.Snapshot()
}

// TestExtractPublishesTheFolder covers the happy path: nested members,
// cosmetic metadata skipped, the archive kept, and no scratch remnant.
func TestExtractPublishesTheFolder(t *testing.T) {
	e, done := startEnv(t)
	defer done()

	archive := buildZip(t, map[string]string{
		"photos/a.jpg":       "aaa",
		"photos/sub/b.jpg":   "bbbb",
		"photos/.DS_Store":   "junk",
		"__MACOSX/._a.jpg":   "junk",
		"Thumbs.db":          "junk",
		"photos/zero.bin":    "",
		"photos/unicode.txt": "ünïcode",
	})
	e.put(t, "photos.zip", archive)

	snap := runRequest(t, e, "photos.zip", "photos")
	if snap.State != StateSucceeded {
		t.Fatalf("state = %s (%+v)", snap.State, snap.Error)
	}
	if snap.Skipped != 3 {
		t.Fatalf("skipped = %d, want 3", snap.Skipped)
	}
	if snap.EntriesDone != 4 {
		t.Fatalf("entriesDone = %d, want 4", snap.EntriesDone)
	}
	for rel, want := range map[string]string{
		"photos/photos/a.jpg":       "aaa",
		"photos/photos/sub/b.jpg":   "bbbb",
		"photos/photos/zero.bin":    "",
		"photos/photos/unicode.txt": "ünïcode",
	} {
		got, err := e.read(t, rel)
		if err != nil {
			t.Fatalf("read %s: %v", rel, err)
		}
		if string(got) != want {
			t.Fatalf("%s = %q, want %q", rel, got, want)
		}
	}
	for _, name := range []string{"photos/photos/__MACOSX", "photos/photos/.DS_Store", "photos/photos/Thumbs.db"} {
		if _, err := e.read(t, name); err == nil {
			t.Fatalf("%s should not exist after a cosmetic skip", name)
		}
	}
	names := e.list(t)
	if !contains(names, "photos.zip") {
		t.Fatalf("the archive must be kept, listing = %v", names)
	}
	if !contains(names, "photos") {
		t.Fatalf("target missing, listing = %v", names)
	}
	if scratch := scratchEntries(names); len(scratch) != 0 {
		t.Fatalf("scratch remnants left: %v", scratch)
	}
}

// TestExtractRefusesUnsafeEntries covers the fail-closed matrix: every
// hostile name fails the job, publishes nothing, and leaves no scratch.
func TestExtractRefusesUnsafeEntries(t *testing.T) {
	cases := []struct {
		name  string
		entry string
	}{
		{"traversal", "../escape.txt"},
		{"nested traversal", "a/../../escape.txt"},
		{"normalizing pair", "a/../b.txt"},
		{"absolute", "/etc/passwd"},
		{"backslash", `a\b.txt`},
		{"nul", "a\x00b.txt"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e, done := startEnv(t)
			defer done()
			e.put(t, "bad.zip", buildZip(t, map[string]string{tc.entry: "x", "ok.txt": "ok"}))
			snap := runRequest(t, e, "bad.zip", "bad")
			if snap.State != StateFailed {
				t.Fatalf("state = %s, want failed", snap.State)
			}
			if snap.Error == nil || snap.Error.Status != 400 {
				t.Fatalf("error = %+v, want 400", snap.Error)
			}
			if !strings.Contains(snap.Error.Message, fmt.Sprintf("%q", tc.entry)) {
				t.Fatalf("error %q should name the offending entry %q", snap.Error.Message, tc.entry)
			}
			assertNothingPublished(t, e, "bad")
		})
	}
}

func TestExtractRefusesSymlinkEntry(t *testing.T) {
	e, done := startEnv(t)
	defer done()

	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	h := &zip.FileHeader{Name: "link"}
	h.SetMode(os.ModeSymlink | 0o777)
	fw, err := w.CreateHeader(h)
	if err != nil {
		t.Fatalf("create symlink header: %v", err)
	}
	if _, err := fw.Write([]byte("/etc")); err != nil {
		t.Fatalf("write symlink: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	e.put(t, "link.zip", buf.Bytes())

	// The symlink itself is a valid entry name; the mode makes it unsafe
	// because extraction would create a link.
	snap := runRequest(t, e, "link.zip", "link")
	if snap.State == StateSucceeded {
		t.Fatalf("a symlink entry must not extract")
	}
	if snap.Error == nil || snap.Error.Status != 400 {
		t.Fatalf("error = %+v, want 400", snap.Error)
	}
	assertNothingPublished(t, e, "link")
}

func TestExtractRefusesEncryptedAndUnsupported(t *testing.T) {
	e, done := startEnv(t)
	defer done()

	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	h := &zip.FileHeader{Name: "secret.txt", Method: zip.Deflate}
	h.Flags |= 0x1 // encrypted
	fw, err := w.CreateHeader(h)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := fw.Write([]byte("x")); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	e.put(t, "enc.zip", buf.Bytes())

	snap := runRequest(t, e, "enc.zip", "enc")
	if snap.State != StateFailed || snap.Error == nil || snap.Error.Status != 400 {
		t.Fatalf("snapshot = %+v, want a 400 failure", snap)
	}
	if !strings.Contains(snap.Error.Message, "encrypted") {
		t.Fatalf("message = %q, want it to say encrypted", snap.Error.Message)
	}
	assertNothingPublished(t, e, "enc")
}

// TestExtractStopsTheBomb: the ceiling counts bytes actually inflated, so
// an archive that expands past it is stopped mid-member.
func TestExtractStopsTheBomb(t *testing.T) {
	e, done := startEnv(t)
	defer done()

	payload := make([]byte, 2<<20)
	for i := range payload {
		payload[i] = byte(i)
	}
	e.put(t, "bomb.zip", buildZip(t, map[string]string{"bomb.bin": string(payload)}))

	snap := runRequest(t, e, "bomb.zip", "bomb", func(r *Request) { r.MaxBytes = 1 << 20 })
	if snap.State != StateFailed {
		t.Fatalf("state = %s, want failed", snap.State)
	}
	if snap.Error == nil || snap.Error.Status != 400 || !strings.Contains(snap.Error.Message, "exceed") {
		t.Fatalf("error = %+v, want a 400 ceiling failure", snap.Error)
	}
	assertNothingPublished(t, e, "bomb")
}

// TestExtractRefusesLyingDeclaredSize: an archive whose central directory
// understates a member is refused too — the reader's own accounting
// rejects it, and nothing is published.
func TestExtractRefusesLyingDeclaredSize(t *testing.T) {
	e, done := startEnv(t)
	defer done()

	payload := make([]byte, 256<<10)
	archive := buildZip(t, map[string]string{"liar.bin": string(payload)})
	e.put(t, "liar.zip", patchCentralUncompressed(t, archive, 1))

	snap := runRequest(t, e, "liar.zip", "liar")
	if snap.State != StateFailed || snap.Error == nil || snap.Error.Status != 400 {
		t.Fatalf("snapshot = %+v, want a 400 failure", snap)
	}
	assertNothingPublished(t, e, "liar")
}

// TestExtractEntryCeiling covers the entry-count ceiling.
func TestExtractEntryCeiling(t *testing.T) {
	e, done := startEnv(t)
	defer done()
	files := map[string]string{}
	for i := 0; i < 5; i++ {
		files["f"+string(rune('a'+i))] = "x"
	}
	e.put(t, "many.zip", buildZip(t, files))
	snap := runRequest(t, e, "many.zip", "many", func(r *Request) { r.MaxEntries = 2 })
	if snap.State != StateFailed || snap.Error == nil || snap.Error.Status != 400 {
		t.Fatalf("snapshot = %+v, want a 400 failure", snap)
	}
	assertNothingPublished(t, e, "many")
}

// TestExtractChecksumMismatchFails loudly instead of publishing
// corrupted content.
func TestExtractChecksumMismatchFails(t *testing.T) {
	e, done := startEnv(t)
	defer done()

	archive := buildZip(t, map[string]string{"data.txt": strings.Repeat("abcdefgh", 64)})
	corrupt := flipPayloadByte(t, archive)
	e.put(t, "corrupt.zip", corrupt)

	snap := runRequest(t, e, "corrupt.zip", "corrupt")
	if snap.State != StateFailed {
		t.Fatalf("state = %s, want failed", snap.State)
	}
	if snap.Error == nil || snap.Error.Status != 400 {
		t.Fatalf("error = %+v, want a 400 failure", snap.Error)
	}
	assertNothingPublished(t, e, "corrupt")
}

func TestExtractTargetExistsIsAConflict(t *testing.T) {
	e, done := startEnv(t)
	defer done()
	e.put(t, "photos.zip", buildZip(t, map[string]string{"a.txt": "a"}))
	cl, err := e.f.SSHClient()
	if err != nil {
		t.Fatalf("ssh: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp: %v", err)
	}
	if err := scl.MkdirAll(e.dir + "/photos"); err != nil {
		t.Fatalf("mkdir target: %v", err)
	}
	_ = scl.Close()

	snap := runRequest(t, e, "photos.zip", "photos")
	if snap.State != StateFailed || snap.Error == nil || snap.Error.Status != 409 {
		t.Fatalf("snapshot = %+v, want a 409 failure", snap)
	}
	// The pre-existing folder must be untouched.
	if names := e.list(t); !contains(names, "photos") {
		t.Fatalf("existing folder disappeared: %v", names)
	}
	if scratch := scratchEntries(e.list(t)); len(scratch) != 0 {
		t.Fatalf("scratch remnants left: %v", scratch)
	}
}

func TestExtractCancelStopsAndCleansUp(t *testing.T) {
	e, done := startEnv(t)
	defer done()
	files := map[string]string{}
	for i := 0; i < 80; i++ {
		files["d"+string(rune('a'+i%26))+"/f"+string(rune('a'+i%26))+".txt"] = strings.Repeat("x", 32)
	}
	archive := buildZip(t, files)
	e.put(t, "big.zip", archive)

	entered := make(chan struct{}, 1)
	reg := NewRegistry()
	j, err := Start(context.Background(), reg, Request{
		VdirID:        "v1",
		Path:          "big.zip",
		Target:        "big",
		ArchiveRemote: e.dir + "/big.zip",
		ArchiveSize:   int64(len(archive)),
		DirRemote:     e.dir,
		TargetName:    "big",
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
	snap, ok := reg.Cancel(context.Background(), "v1", j.id, 10*time.Second)
	if !ok {
		t.Fatal("cancel must find the job")
	}
	if snap.State != StateCanceled {
		t.Fatalf("state = %s, want canceled", snap.State)
	}
	assertNothingPublished(t, e, "big")
}

// TestExtractRevokedAccessFailsClosed covers the mid-job re-check: a
// withdrawn grant stops the job and publishes nothing.
func TestExtractRevokedAccessFailsClosed(t *testing.T) {
	e, done := startEnv(t)
	defer done()
	e.put(t, "photos.zip", buildZip(t, map[string]string{"a.txt": "a", "b/c.txt": "c"}))

	snap := runRequest(t, e, "photos.zip", "photos", func(r *Request) {
		r.Authorize = func(context.Context) error { return ErrForbidden }
	})
	if snap.State != StateFailed {
		t.Fatalf("state = %s, want failed", snap.State)
	}
	if snap.Error == nil || snap.Error.Status != 403 {
		t.Fatalf("error = %+v, want 403", snap.Error)
	}
	assertNothingPublished(t, e, "photos")
}

func assertNothingPublished(t *testing.T, e *fixtureEnv, target string) {
	t.Helper()
	for _, name := range e.list(t) {
		if name == target {
			t.Fatalf("target %q exists after a failed extraction", target)
		}
		if strings.Contains(name, ".sfext-") {
			t.Fatalf("scratch directory %q left behind", name)
		}
	}
}

func contains(names []string, want string) bool {
	for _, n := range names {
		if n == want {
			return true
		}
	}
	return false
}

func scratchEntries(names []string) []string {
	out := []string{}
	for _, n := range names {
		if strings.Contains(n, ".sfext-") {
			out = append(out, n)
		}
	}
	return out
}

// patchCentralUncompressed rewrites the uncompressed size in every
// central-directory record, so an archive can lie about its expansion.
// It walks the real directory (payload bytes can contain the same magic).
func patchCentralUncompressed(t *testing.T, data []byte, size uint32) []byte {
	t.Helper()
	out := append([]byte(nil), data...)
	eocd := -1
	for i := len(out) - 22; i >= 0; i-- {
		if binary.LittleEndian.Uint32(out[i:]) == 0x06054b50 {
			eocd = i
			break
		}
	}
	if eocd < 0 {
		t.Fatal("no end-of-central-directory record")
	}
	count := int(binary.LittleEndian.Uint16(out[eocd+10:]))
	off := int(binary.LittleEndian.Uint32(out[eocd+16:]))
	for n := 0; n < count; n++ {
		if off+46 > len(out) || binary.LittleEndian.Uint32(out[off:]) != 0x02014b50 {
			t.Fatalf("central record %d at %d is malformed", n, off)
		}
		binary.LittleEndian.PutUint32(out[off+24:], size)
		nameLen := int(binary.LittleEndian.Uint16(out[off+28:]))
		extraLen := int(binary.LittleEndian.Uint16(out[off+30:]))
		commentLen := int(binary.LittleEndian.Uint16(out[off+32:]))
		off += 46 + nameLen + extraLen + commentLen
	}
	return out
}

// flipPayloadByte corrupts the first stored member's data without
// touching its CRC, so the reader reports a checksum mismatch.
func flipPayloadByte(t *testing.T, data []byte) []byte {
	t.Helper()
	out := append([]byte(nil), data...)
	for i := 0; i+30 <= len(out); i++ {
		if binary.LittleEndian.Uint32(out[i:]) != 0x04034b50 {
			continue
		}
		nameLen := int(binary.LittleEndian.Uint16(out[i+26:]))
		extraLen := int(binary.LittleEndian.Uint16(out[i+28:]))
		start := i + 30 + nameLen + extraLen
		if start < len(out) {
			out[start] ^= 0xff
			return out
		}
	}
	t.Fatal("no stored member found to corrupt")
	return data
}
