package e2eharness_test

import (
	"testing"

	"github.com/mode777/stratofold/internal/e2eharness"
)

// TestSeedCarriesRemoteDirIntoVdirRoot checks the E2E seed uses the
// connection's remote directory as the default vdir root path, so the
// browser prefill flow is exercised against the same value.
func TestSeedCarriesRemoteDirIntoVdirRoot(t *testing.T) {
	s, err := e2eharness.Start(t.TempDir(), "")
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer s.Close()

	conns, err := s.App.FindAllRecords("connections")
	if err != nil {
		t.Fatalf("connections: %v", err)
	}
	if len(conns) != 1 {
		t.Fatalf("connections = %d, want 1", len(conns))
	}
	remoteDir := conns[0].GetString("remote_dir")
	if remoteDir == "" {
		t.Fatalf("seeded connection has no remote_dir")
	}

	vdirs, err := s.App.FindAllRecords("vdirs")
	if err != nil {
		t.Fatalf("vdirs: %v", err)
	}
	if len(vdirs) != 2 {
		t.Fatalf("vdirs = %d, want 2", len(vdirs))
	}
	for _, vd := range vdirs {
		if got := vd.GetString("root_path"); got != remoteDir {
			t.Fatalf("vdir %s root_path = %q, want the connection remote_dir %q", vd.Id, got, remoteDir)
		}
	}
}
