package fileserver_test

import (
	"os"
	"os/exec"
	"testing"

	"github.com/mode777/stratofold/internal/testapp"
)

// TestGoldenCurlMatrix runs the in-repo golden script (design D8)
// against a live server + in-proc SSH fixture: the client-side view of
// the whole matrix — real curl, real HTTP stack, out-of-process. On
// the build server the same script runs against an external OpenSSH
// (SF_TESTSSH_MODE=external) and `go run ./cmd/stratofold serve`.
func TestGoldenCurlMatrix(t *testing.T) {
	script := "../../scripts/fileserver-golden.sh"
	if _, err := os.Stat(script); err != nil {
		t.Fatalf("golden script missing: %v", err)
	}
	if _, err := exec.LookPath("curl"); err != nil {
		t.Skip("curl not available")
	}
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash not available")
	}

	e := setup(t)
	cmd := exec.Command("bash", script)
	cmd.Env = append(os.Environ(),
		"SF_BASE_URL="+e.s.BaseURL,
		"SF_EMAIL="+testapp.TestUserEmail,
		"SF_PASSWORD="+testapp.TestUserPassword,
		"SF_VDIR_ID="+e.privID,
		"SF_PUB_VDIR_ID="+e.pubID,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("golden matrix failed:\n%s", out)
	}
	t.Logf("golden matrix output:\n%s", out)
}
