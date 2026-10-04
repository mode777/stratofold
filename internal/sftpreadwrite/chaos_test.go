package sftpreadwrite_test

import (
	"bytes"
	"context"
	"math/rand"
	"testing"

	"github.com/mode777/stratofold/internal/sftpreadwrite"
	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/testssh"
)

// TestChaosKillAtRandomOffsets: kill the SSH connection at randomized
// offsets repeatedly during single transfers; the final checksum must
// match the source every run (retires R1, R6-for-streams).
//
// In inproc mode kills are server-side; in external/docker mode they
// are client-side (no daemon access), which exercises the identical
// client recovery path.
func TestChaosKillAtRandomOffsets(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	rng := rand.New(rand.NewSource(20261003))
	const size = 8 << 20 // 8 MiB per transfer

	for round := 0; round < 10; round++ {
		src := testssh.RandomBytes(int64(1000+round), size)

		// 1-3 kills at random offsets within the transfer.
		kills := 1 + rng.Intn(3)
		thresholds := make([]int64, kills)
		for i := range thresholds {
			thresholds[i] = 64 << 10 // floor: past handshake
			thresholds[i] += rng.Int63n(size)
		}

		m, err := f.NewManager(sshconn.WithConnWrap(testssh.NewKillSwitch(thresholds...).Wrap()))
		if err != nil {
			t.Fatal(err)
		}

		// Download: seed remotely, read back through kills, compare.
		rel := "chaos-dl.bin"
		writeDirect(t, f, rel, src)
		tr := sftpreadwrite.New(m, f.Path(rel), sftpreadwrite.Options{})
		var out bytes.Buffer
		if _, err := tr.ReadAll(context.Background(), &out); err != nil {
			t.Fatalf("round %d download: %v", round, err)
		}
		if !bytes.Equal(out.Bytes(), src) {
			t.Fatalf("round %d: download checksum mismatch after %d kills", round, kills)
		}

		// Upload: write through kills, compare remotely.
		rel = "chaos-ul.bin"
		tr = sftpreadwrite.New(m, f.Path(rel), sftpreadwrite.Options{})
		if _, err := tr.WriteAll(context.Background(), bytes.NewReader(src), int64(len(src))); err != nil {
			t.Fatalf("round %d upload: %v", round, err)
		}
		if got := remoteSHA256(t, f, rel); got != localSHA256(src) {
			t.Fatalf("round %d: upload checksum mismatch after %d kills", round, kills)
		}
		m.Close()
	}
}
