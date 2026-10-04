package sftpreadwrite_test

import (
	"context"
	"io"
	"os"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/mode777/stratofold/internal/sftpreadwrite"
	"github.com/mode777/stratofold/internal/testssh"
)

// The risk-retirement gates are long-running; enable with
// SF_RUN_GATES=1 (they still run against whatever fixture mode
// resolves — use SF_TESTSSH_MODE=external to retire R1/R2 against a
// real OpenSSH).

func gatesEnabled() bool { return os.Getenv("SF_RUN_GATES") == "1" }

// TestThroughputGate: SFTP streaming throughput must stay within the
// margin of a raw `dd` over SSH on the same channel (retires R2 — the
// gate catches pipeline collapse, which scores a small fraction of the
// baseline, not single-digit-percent tuning differences).
//
// The margin is deliberately 0.65 rather than the initial 0.80: the
// achievable ratio is host-dependent (x/crypto channel window + crypto
// overhead vs `dd` over an exec channel). Measured non-regression
// envelope: 0.85–0.87 on the original dev host (change-1 design
// D6-outcome), 0.70–0.83 on later hosts, dipping to 0.70 only under
// parallel gate load. 0.65 sits below every healthy run with headroom
// while still failing loudly on any real pipelining regression.
func TestThroughputGate(t *testing.T) {
	if !gatesEnabled() {
		t.Skip("set SF_RUN_GATES=1 to run the gates")
	}
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	m, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	const size = int64(256 << 20) // 256 MiB
	sparse := f.Path("sparse4g.bin")
	// Warm-up.
	warm := sftpreadwrite.New(m, f.Path("hello.txt"), sftpreadwrite.Options{})
	if _, err := warm.ReadAll(context.Background(), io.Discard); err != nil {
		t.Fatal(err)
	}

	// Baseline: raw dd over an SSH exec session.
	baseRead := timeTransfer(t, func() error {
		cl, err := f.SSHClient()
		if err != nil {
			return err
		}
		sess, err := cl.NewSession()
		if err != nil {
			return err
		}
		defer sess.Close()
		sess.Stdout = io.Discard
		return sess.Run("dd if=" + sparse + " bs=1M count=" + strconv.FormatInt(size>>20, 10))
	})

	// SFTP offset-read stream of the same byte count.
	sftpRead := timeTransfer(t, func() error {
		tr := sftpreadwrite.New(m, sparse, sftpreadwrite.Options{})
		_, err := tr.ReadN(context.Background(), io.Discard, size)
		return err
	})

	margin := 0.65
	ratio := float64(baseRead) / float64(sftpRead)
	t.Logf("throughput: baseline=%v sftp=%v ratio=%.2f (margin %.2f)", baseRead, sftpRead, ratio, margin)
	if ratio < margin {
		t.Fatalf("SFTP read throughput %.2f%% of baseline, below %.2f%% gate", ratio*100, margin*100)
	}
}

// TestMemoryGate: peak memory stays bounded while streaming a 4 GiB
// file in both directions (no whole-file buffering).
func TestMemoryGate(t *testing.T) {
	if !gatesEnabled() {
		t.Skip("set SF_RUN_GATES=1 to run the gates")
	}
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	const budget = int64(64 << 20) // 64 MiB headroom over process start
	hwmBefore := vmHWM(t)

	m, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	tr := sftpreadwrite.New(m, f.Path("sparse4g.bin"), sftpreadwrite.Options{})

	stop := make(chan struct{})
	var peak int64
	go func() {
		for {
			select {
			case <-stop:
				return
			case <-time.After(100 * time.Millisecond):
			}
			var ms runtime.MemStats
			runtime.ReadMemStats(&ms)
			if int64(ms.HeapAlloc) > peak {
				peak = int64(ms.HeapAlloc)
			}
		}
	}()

	n, err := tr.ReadAll(context.Background(), io.Discard)
	if err != nil || n != testssh.SparseSize {
		t.Fatalf("4GiB read: n=%d err=%v", n, err)
	}

	zero := &zeros{}
	wtr := sftpreadwrite.New(m, f.Path("mem-write.bin"), sftpreadwrite.Options{})
	if n, err := wtr.WriteAll(context.Background(), zero, testssh.SparseSize); err != nil || n != testssh.SparseSize {
		t.Fatalf("4GiB write: n=%d err=%v", n, err)
	}
	close(stop)

	hwmAfter := vmHWM(t)
	t.Logf("memory: heap peak=%d MiB, VmHWM delta=%d MiB (budget %d MiB)",
		peak>>20, (hwmAfter-hwmBefore)>>20, budget>>20)
	if d := hwmAfter - hwmBefore; d > budget {
		t.Fatalf("peak RSS grew %d MiB, budget %d MiB — whole-file buffering suspected", d>>20, budget>>20)
	}
	_, _ = f.Exec("rm -f " + f.Path("mem-write.bin"))
}

type zeros struct{}

func (z *zeros) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}

func timeTransfer(t *testing.T, fn func() error) time.Duration {
	t.Helper()
	start := time.Now()
	if err := fn(); err != nil {
		t.Fatalf("transfer: %v", err)
	}
	return time.Since(start)
}

// vmHWM reads the process high-water RSS from /proc (Linux).
func vmHWM(t *testing.T) int64 {
	t.Helper()
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		t.Skip("no /proc/self/status")
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "VmHWM:") {
			fields := strings.Fields(line)
			kb, _ := strconv.ParseInt(fields[1], 10, 64)
			return kb << 10
		}
	}
	t.Skip("VmHWM not found")
	return 0
}
