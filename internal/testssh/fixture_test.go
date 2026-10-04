package testssh

import (
	"testing"

	"github.com/pkg/sftp"
)

// TestFixtureServesSeededDataset verifies the fixture backend starts,
// authenticates (password + pinned host key) and serves the seeded
// dataset. Docker-mode container bring-up is deferred (D7 environment
// note): with SF_TESTSSH_MODE=docker this runs wherever a Docker
// daemon exists.
func TestFixtureServesSeededDataset(t *testing.T) {
	f := Start(t, Options{})
	defer f.Close()

	if f.Fingerprint == "" {
		t.Fatal("fixture produced no fingerprint")
	}
	if _, err := f.Exec("sha256sum " + f.Path("hello.txt")); err != nil {
		t.Fatalf("exec sha256sum: %v", err)
	}

	cl, err := f.SSHClient()
	if err != nil {
		t.Fatalf("ssh client: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp client: %v", err)
	}
	defer scl.Close()

	rf, err := scl.Open(f.Path("hello.txt"))
	if err != nil {
		t.Fatalf("open hello.txt: %v", err)
	}
	defer rf.Close()
	buf := make([]byte, 64)
	n, _ := rf.Read(buf)
	if string(buf[:n]) != "hello stratofold\n" {
		t.Fatalf("hello.txt = %q", buf[:n])
	}

	st, err := scl.Stat(f.Path("sparse4g.bin"))
	if err != nil {
		t.Fatalf("stat sparse: %v", err)
	}
	if st.Size() != SparseSize {
		t.Fatalf("sparse size = %d, want %d", st.Size(), SparseSize)
	}
}

func TestRandomBytesDeterministic(t *testing.T) {
	a := RandomBytes(9, 1024)
	b := RandomBytes(9, 1024)
	c := RandomBytes(10, 1024)
	if string(a) != string(b) {
		t.Fatal("RandomBytes not deterministic")
	}
	if string(a) == string(c) {
		t.Fatal("different seeds produced identical bytes")
	}
}
