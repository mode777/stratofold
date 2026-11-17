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

// isDir reports whether rel exists as a directory, for asserting that
// explicit directory entries created their folder.
func (e *fixtureEnv) isDir(t *testing.T, rel string) bool {
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
	fi, err := scl.Stat(e.dir + "/" + rel)
	return err == nil && fi.IsDir()
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

// TestExtractDirectoryEntriesWithTrailingSlash is the reported-regression
// shape: real zip tools mark directory entries with a trailing slash, and
// that slash must read as the directory marker, not an empty segment.
func TestExtractDirectoryEntriesWithTrailingSlash(t *testing.T) {
	e, done := startEnv(t)
	defer done()

	e.put(t, "poly.zip", buildZip(t, map[string]string{
		"POLY_SurvivalWorkshop/":              "",
		"POLY_SurvivalWorkshop/readme.txt":    "the workshop",
		"POLY_SurvivalWorkshop/blueprints/":   "",
		"POLY_SurvivalWorkshop/blueprints/ox": "oxidizer",
	}))
	snap := runRequest(t, e, "poly.zip", "POLY_SurvivalWorkshop")
	if snap.State != StateSucceeded {
		t.Fatalf("state = %s (%+v)", snap.State, snap.Error)
	}
	if snap.Skipped != 0 {
		t.Fatalf("skipped = %d, want 0 (directory entries are not skips)", snap.Skipped)
	}
	if got, err := e.read(t, "POLY_SurvivalWorkshop/POLY_SurvivalWorkshop/readme.txt"); err != nil || string(got) != "the workshop" {
		t.Fatalf("readme.txt = %q, %v", got, err)
	}
	if got, err := e.read(t, "POLY_SurvivalWorkshop/POLY_SurvivalWorkshop/blueprints/ox"); err != nil || string(got) != "oxidizer" {
		t.Fatalf("blueprints/ox = %q, %v", got, err)
	}
	// The explicit empty directory exists too, not just the file paths.
	if !e.isDir(t, "POLY_SurvivalWorkshop/POLY_SurvivalWorkshop/blueprints") {
		t.Fatal("explicit directory entry did not create the directory")
	}
}

// TestExtractSkipsUnsafeEntries covers the skip matrix: every hostile
// name skips its entry, the rest of the archive publishes, and the skip
// is counted and named.
func TestExtractSkipsUnsafeEntries(t *testing.T) {
	cases := []struct {
		name   string
		entry  string
		reason SkipReason
	}{
		{"traversal", "../escape.txt", ReasonUnsafeName},
		{"nested traversal", "a/../../escape.txt", ReasonUnsafeName},
		{"normalizing pair", "a/../b.txt", ReasonUnsafeName},
		{"absolute", "/etc/passwd", ReasonUnsafeName},
		{"backslash", `a\b.txt`, ReasonUnsafeName},
		{"nul", "a\x00b.txt", ReasonUnsafeName},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e, done := startEnv(t)
			defer done()
			e.put(t, "bad.zip", buildZip(t, map[string]string{tc.entry: "x", "ok.txt": "ok"}))
			snap := runRequest(t, e, "bad.zip", "bad")
			if snap.State != StateSucceeded {
				t.Fatalf("state = %s (%+v), want succeeded", snap.State, snap.Error)
			}
			if snap.SkippedInvalid != 1 {
				t.Fatalf("skippedInvalid = %d, want 1", snap.SkippedInvalid)
			}
			if len(snap.SkippedDetails) != 1 || snap.SkippedDetails[0].Name != tc.entry ||
				snap.SkippedDetails[0].Reason != string(tc.reason) {
				t.Fatalf("skippedDetails = %+v, want [%s %s]", snap.SkippedDetails, tc.entry, tc.reason)
			}
			if got, err := e.read(t, "bad/ok.txt"); err != nil || string(got) != "ok" {
				t.Fatalf("ok.txt = %q, %v — the rest of the archive must publish", got, err)
			}
			// The hostile entry itself never landed anywhere.
			if _, err := e.read(t, "bad/escape.txt"); err == nil {
				t.Fatal("escape.txt exists inside the target folder")
			}
			if scratch := scratchEntries(e.list(t)); len(scratch) != 0 {
				t.Fatalf("scratch remnants left: %v", scratch)
			}
		})
	}
}

func TestExtractSkipsSymlinkEntry(t *testing.T) {
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
	ok, err := w.Create("ok.txt")
	if err != nil {
		t.Fatalf("create ok.txt: %v", err)
	}
	if _, err := ok.Write([]byte("ok")); err != nil {
		t.Fatalf("write ok.txt: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	e.put(t, "link.zip", buf.Bytes())

	// The symlink itself has a valid entry name; the mode makes it unsafe
	// because extraction would create a link. It skips, the rest extracts,
	// and no link is ever created.
	snap := runRequest(t, e, "link.zip", "link")
	if snap.State != StateSucceeded {
		t.Fatalf("state = %s (%+v)", snap.State, snap.Error)
	}
	if snap.SkippedInvalid != 1 || len(snap.SkippedDetails) != 1 ||
		snap.SkippedDetails[0].Name != "link" || snap.SkippedDetails[0].Reason != string(ReasonSymlink) {
		t.Fatalf("snapshot skips = %+v", snap)
	}
	if _, err := e.read(t, "link/link"); err == nil {
		t.Fatal("a symlink entry must not extract, inside or outside the folder")
	}
	if got, err := e.read(t, "link/ok.txt"); err != nil || string(got) != "ok" {
		t.Fatalf("ok.txt = %q, %v", got, err)
	}
}

// buildEncryptedAndUnsupportedZip hand-assembles an archive mixing an
// encrypted entry and a bzip2-compressed entry (the Go writer emits
// neither) beside a plain member.
func buildEncryptedAndUnsupportedZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	enc := &zip.FileHeader{Name: "secret.txt", Method: zip.Deflate}
	enc.Flags |= 0x1 // encrypted
	fw, err := w.CreateHeader(enc)
	if err != nil {
		t.Fatalf("create encrypted header: %v", err)
	}
	if _, err := fw.Write([]byte("x")); err != nil {
		t.Fatalf("write encrypted: %v", err)
	}
	// archive/zip only names Store and Deflate; 12 is bzip2, which the
	// extractor must refuse to decode.
	const methodBzip2 = 12
	if _, err := w.CreateRaw(&zip.FileHeader{Name: "packed.txt", Method: methodBzip2, CRC32: 0}); err != nil {
		t.Fatalf("create raw bzip2 header: %v", err)
	}
	ok, err := w.Create("ok.txt")
	if err != nil {
		t.Fatalf("create ok.txt: %v", err)
	}
	if _, err := ok.Write([]byte("ok")); err != nil {
		t.Fatalf("write ok.txt: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	return buf.Bytes()
}

func TestExtractSkipsEncryptedAndUnsupportedEntries(t *testing.T) {
	e, done := startEnv(t)
	defer done()
	e.put(t, "mixed.zip", buildEncryptedAndUnsupportedZip(t))

	snap := runRequest(t, e, "mixed.zip", "mixed")
	if snap.State != StateSucceeded {
		t.Fatalf("state = %s (%+v)", snap.State, snap.Error)
	}
	if snap.SkippedInvalid != 2 {
		t.Fatalf("skippedInvalid = %d, want 2", snap.SkippedInvalid)
	}
	byName := map[string]string{}
	for _, d := range snap.SkippedDetails {
		byName[d.Name] = d.Reason
	}
	if byName["secret.txt"] != string(ReasonEncrypted) {
		t.Fatalf("secret.txt reason = %q, want encrypted", byName["secret.txt"])
	}
	if byName["packed.txt"] != string(ReasonUnsupportedCompression) {
		t.Fatalf("packed.txt reason = %q, want unsupported-compression", byName["packed.txt"])
	}
	if got, err := e.read(t, "mixed/ok.txt"); err != nil || string(got) != "ok" {
		t.Fatalf("ok.txt = %q, %v", got, err)
	}
}

// TestExtractSkipsOverDeepEntry: an entry beyond the depth bound is
// skipped and counted while the rest of the archive extracts (the depth
// ceiling moved from a job failure to a per-entry skip).
func TestExtractSkipsOverDeepEntry(t *testing.T) {
	e, done := startEnv(t)
	defer done()

	deep := strings.Repeat("d/", MaxDepth) + "f.txt" // MaxDepth+1 segments
	e.put(t, "deep.zip", buildZip(t, map[string]string{
		deep:     "x",
		"ok.txt": "ok",
	}))
	snap := runRequest(t, e, "deep.zip", "deep")
	if snap.State != StateSucceeded {
		t.Fatalf("state = %s (%+v)", snap.State, snap.Error)
	}
	if snap.SkippedInvalid != 1 || len(snap.SkippedDetails) != 1 ||
		snap.SkippedDetails[0].Reason != string(ReasonDepth) {
		t.Fatalf("snapshot skips = %+v, want one depth skip", snap)
	}
	if got, err := e.read(t, "deep/ok.txt"); err != nil || string(got) != "ok" {
		t.Fatalf("ok.txt = %q, %v", got, err)
	}
}

// TestExtractEntryCeilingCountsInvalidEntries: an archive of mostly
// invalid entries cannot dodge the entry-count ceiling — every
// central-directory record counts (design D6).
func TestExtractEntryCeilingCountsInvalidEntries(t *testing.T) {
	e, done := startEnv(t)
	defer done()

	files := map[string]string{}
	for i := 0; i < 5; i++ {
		files[fmt.Sprintf("../bad%d.txt", i)] = "x"
	}
	e.put(t, "hostile.zip", buildZip(t, files))
	snap := runRequest(t, e, "hostile.zip", "hostile", func(r *Request) { r.MaxEntries = 2 })
	if snap.State != StateFailed || snap.Error == nil || snap.Error.Status != 400 {
		t.Fatalf("snapshot = %+v, want a 400 ceiling failure", snap)
	}
	if !strings.Contains(snap.Error.Message, "entries") {
		t.Fatalf("message = %q, want the entry ceiling", snap.Error.Message)
	}
	assertNothingPublished(t, e, "hostile")
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

// TestExtractNothingExtractedGuard covers the all-skipped guard (design
// D5): when no member was extracted the job fails explicitly and
// publishes nothing, naming the dominant reason.
func TestExtractNothingExtractedGuard(t *testing.T) {
	cosmeticOnly := buildZip(t, map[string]string{
		".DS_Store":    "junk",
		"__MACOSX/._a": "junk",
		"Thumbs.db":    "junk",
	})
	allTraversal := buildZip(t, map[string]string{
		"../escape.txt": "x",
		"../other.txt":  "y",
	})
	var encryptedOnly bytes.Buffer
	w := zip.NewWriter(&encryptedOnly)
	h := &zip.FileHeader{Name: "secret.txt", Method: zip.Deflate}
	h.Flags |= 0x1 // encrypted
	fw, err := w.CreateHeader(h)
	if err != nil {
		panic(err)
	}
	if _, err := fw.Write([]byte("x")); err != nil {
		panic(err)
	}
	if err := w.Close(); err != nil {
		panic(err)
	}

	cases := []struct {
		name    string
		archive []byte
		reason  string // "" = the no-extractable-entries wording
		skips   bool   // whether skips must be reported with the failure
	}{
		{"all traversal", allTraversal, string(ReasonUnsafeName), true},
		{"fully encrypted", encryptedOnly.Bytes(), string(ReasonEncrypted), true},
		{"cosmetic only", cosmeticOnly, "", true},
		{"empty archive", buildZip(t, map[string]string{}), "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e, done := startEnv(t)
			defer done()
			e.put(t, "none.zip", tc.archive)
			snap := runRequest(t, e, "none.zip", "none")
			if snap.State != StateFailed {
				t.Fatalf("state = %s (%+v), want failed", snap.State, snap.Error)
			}
			if snap.Error == nil || snap.Error.Status != 400 {
				t.Fatalf("error = %+v, want a 400 failure", snap.Error)
			}
			if !strings.Contains(snap.Error.Message, "nothing could be extracted") {
				t.Fatalf("message = %q, want the nothing-extracted wording", snap.Error.Message)
			}
			if tc.reason != "" && !strings.Contains(snap.Error.Message, tc.reason) {
				t.Fatalf("message = %q, want it to name the reason %q", snap.Error.Message, tc.reason)
			}
			// The skip counts are still reported with the failure.
			if tc.skips && snap.SkippedInvalid == 0 && snap.Skipped == 0 {
				t.Fatalf("snapshot reports no skips: %+v", snap)
			}
			assertNothingPublished(t, e, "none")
		})
	}
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

// TestExtractCorruptMemberSkips: a member whose stored data fails its
// checksum is skipped — partial output removed, skip counted with the
// corrupt reason — while intact members publish byte-identical.
func TestExtractCorruptMemberSkips(t *testing.T) {
	e, done := startEnv(t)
	defer done()

	// Sorted order puts data.txt first, so flipPayloadByte corrupts it.
	archive := buildZip(t, map[string]string{
		"data.txt": strings.Repeat("abcdefgh", 64),
		"good.txt": "good",
	})
	e.put(t, "corrupt.zip", flipPayloadByte(t, archive))

	snap := runRequest(t, e, "corrupt.zip", "corrupt")
	if snap.State != StateSucceeded {
		t.Fatalf("state = %s (%+v)", snap.State, snap.Error)
	}
	if snap.SkippedInvalid != 1 || len(snap.SkippedDetails) != 1 ||
		snap.SkippedDetails[0].Name != "data.txt" || snap.SkippedDetails[0].Reason != string(ReasonCorrupt) {
		t.Fatalf("snapshot skips = %+v, want one corrupt skip of data.txt", snap)
	}
	if got, err := e.read(t, "corrupt/good.txt"); err != nil || string(got) != "good" {
		t.Fatalf("good.txt = %q, %v — intact members must publish byte-identical", got, err)
	}
	// The unreadable member (and any partial write of it) is gone.
	if _, err := e.read(t, "corrupt/data.txt"); err == nil {
		t.Fatal("the corrupt member was published")
	}
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
