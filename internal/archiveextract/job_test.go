package archiveextract

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func waitDone(t *testing.T, j *Job) Snapshot {
	t.Helper()
	select {
	case <-j.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("job did not finish")
	}
	return j.Snapshot()
}

func TestRegistryReportsProgressAndSucceeds(t *testing.T) {
	reg := NewRegistry()
	j, err := reg.Start(context.Background(), "v1", Snapshot{Path: "docs/a.zip", Target: "docs/a"}, "k1",
		func(_ context.Context, j *Job) error {
			j.setTotals(2, 10)
			j.setSkipped(3)
			j.setPhase(PhaseExtracting)
			j.entryStarted("a.txt")
			j.entryDone(4)
			j.entryDone(6)
			return nil
		})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	snap := waitDone(t, j)
	if snap.State != StateSucceeded {
		t.Fatalf("state = %s, want succeeded", snap.State)
	}
	if snap.EntriesTotal != 2 || snap.EntriesDone != 2 || snap.BytesDone != 10 || snap.Skipped != 3 {
		t.Fatalf("counters = %+v", snap)
	}
	if snap.FinishedAt == nil {
		t.Fatal("finishedAt must be set")
	}
	if len(snap.ID) != 32 {
		t.Fatalf("job id %q is not 128-bit hex", snap.ID)
	}
}

func TestRegistryLookupIsScopedToTheVdir(t *testing.T) {
	reg := NewRegistry()
	j, err := reg.Start(context.Background(), "v1", Snapshot{Path: "a.zip", Target: "a"}, "k1",
		func(context.Context, *Job) error { return nil })
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	waitDone(t, j)
	if _, ok := reg.Lookup("v1", j.id); !ok {
		t.Fatal("lookup in the owning vdir must succeed")
	}
	if _, ok := reg.Lookup("v2", j.id); ok {
		t.Fatal("lookup in another vdir must not succeed")
	}
	if _, ok := reg.Lookup("v1", "deadbeef"); ok {
		t.Fatal("unknown id must not resolve")
	}
}

func TestRegistryRefusesSameTarget(t *testing.T) {
	reg := NewRegistry()
	block := make(chan struct{})
	started := make(chan struct{})
	j, err := reg.Start(context.Background(), "v1", Snapshot{Path: "a.zip", Target: "a"}, "same",
		func(ctx context.Context, _ *Job) error {
			close(started)
			select {
			case <-block:
			case <-ctx.Done():
			}
			return nil
		})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	<-started
	if _, err := reg.Start(context.Background(), "v1", Snapshot{Path: "a.zip", Target: "a"}, "same",
		func(context.Context, *Job) error { return nil }); !errors.Is(err, ErrAlreadyRunning) {
		t.Fatalf("second Start err = %v, want ErrAlreadyRunning", err)
	}
	close(block)
	waitDone(t, j)

	// Once the first job is finished the target is free again.
	second, err := reg.Start(context.Background(), "v1", Snapshot{Path: "a.zip", Target: "a"}, "same",
		func(context.Context, *Job) error { return nil })
	if err != nil {
		t.Fatalf("Start after completion: %v", err)
	}
	waitDone(t, second)
}

func TestRegistryConcurrencyCap(t *testing.T) {
	old := MaxConcurrentJobs
	MaxConcurrentJobs = 1
	defer func() { MaxConcurrentJobs = old }()

	reg := NewRegistry()
	block := make(chan struct{})
	started := make(chan struct{})
	j, err := reg.Start(context.Background(), "v1", Snapshot{Path: "a.zip", Target: "a"}, "k1",
		func(ctx context.Context, _ *Job) error {
			close(started)
			select {
			case <-block:
			case <-ctx.Done():
			}
			return nil
		})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	<-started
	if _, err := reg.Start(context.Background(), "v1", Snapshot{Path: "b.zip", Target: "b"}, "k2",
		func(context.Context, *Job) error { return nil }); !errors.Is(err, ErrBusy) {
		t.Fatalf("Start over the cap err = %v, want ErrBusy", err)
	}
	close(block)
	waitDone(t, j)

	j2, err := reg.Start(context.Background(), "v1", Snapshot{Path: "b.zip", Target: "b"}, "k2",
		func(context.Context, *Job) error { return nil })
	if err != nil {
		t.Fatalf("Start after the cap freed: %v", err)
	}
	waitDone(t, j2)
}

func TestRegistryEvictsTerminalJobsAndKeepsOutput(t *testing.T) {
	base := time.Unix(1_700_000_000, 0)
	reg := NewRegistry()
	reg.now = func() time.Time { return base }
	j, err := reg.Start(context.Background(), "v1", Snapshot{Path: "a.zip", Target: "a"}, "k1",
		func(context.Context, *Job) error { return nil })
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	waitDone(t, j)
	if _, ok := reg.Lookup("v1", j.id); !ok {
		t.Fatal("terminal job must stay observable inside the retention window")
	}

	reg.now = func() time.Time { return base.Add(JobRetention + time.Minute) }
	if _, ok := reg.Lookup("v1", j.id); ok {
		t.Fatal("terminal job must be evicted after retention")
	}
}

func TestRegistryCancelIsIdempotent(t *testing.T) {
	reg := NewRegistry()
	started := make(chan struct{})
	j, err := reg.Start(context.Background(), "v1", Snapshot{Path: "a.zip", Target: "a"}, "k1",
		func(ctx context.Context, _ *Job) error {
			close(started)
			<-ctx.Done()
			return ctx.Err()
		})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	<-started
	snap, ok := reg.Cancel(context.Background(), "v1", j.id, 2*time.Second)
	if !ok {
		t.Fatal("cancel must find the job")
	}
	if snap.State != StateCanceled {
		t.Fatalf("state = %s, want canceled", snap.State)
	}

	// Canceling again reports the same terminal state without error.
	snap2, ok := reg.Cancel(context.Background(), "v1", j.id, time.Second)
	if !ok || snap2.State != StateCanceled {
		t.Fatalf("second cancel = %+v, %v", snap2, ok)
	}
	if _, ok := reg.Cancel(context.Background(), "v2", j.id, 0); ok {
		t.Fatal("cancel from another vdir must not resolve")
	}
}

func TestRegistryPanicBecomesFailure(t *testing.T) {
	reg := NewRegistry()
	j, err := reg.Start(context.Background(), "v1", Snapshot{Path: "a.zip", Target: "a"}, "k1",
		func(context.Context, *Job) error { panic("boom") })
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	snap := waitDone(t, j)
	if snap.State != StateFailed {
		t.Fatalf("state = %s, want failed", snap.State)
	}
	if snap.Error == nil || snap.Error.Status != 500 {
		t.Fatalf("error = %+v, want a 500-class failure", snap.Error)
	}
	// The slot must be released even after a panic.
	if _, err := reg.Start(context.Background(), "v1", Snapshot{Path: "b.zip", Target: "b"}, "k2",
		func(context.Context, *Job) error { return nil }); err != nil {
		t.Fatalf("Start after panic: %v", err)
	}
}

func TestRegistryFailureCarriesItsClass(t *testing.T) {
	reg := NewRegistry()
	j, err := reg.Start(context.Background(), "v1", Snapshot{Path: "a.zip", Target: "a"}, "k1",
		func(context.Context, *Job) error { return ErrTargetExists })
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	snap := waitDone(t, j)
	if snap.State != StateFailed {
		t.Fatalf("state = %s, want failed", snap.State)
	}
	if snap.Error == nil || snap.Error.Status != 409 {
		t.Fatalf("error = %+v, want status 409", snap.Error)
	}
}

func TestRegistryCountersAreMonotonicUnderConcurrentUpdates(t *testing.T) {
	reg := NewRegistry()
	j, err := reg.Start(context.Background(), "v1", Snapshot{Path: "a.zip", Target: "a"}, "k1",
		func(_ context.Context, job *Job) error {
			var wg sync.WaitGroup
			for i := 0; i < 50; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					job.entryDone(1)
				}()
			}
			wg.Wait()
			return nil
		})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	snap := waitDone(t, j)
	if snap.EntriesDone != 50 || snap.BytesDone != 50 {
		t.Fatalf("counters = %d/%d, want 50/50", snap.EntriesDone, snap.BytesDone)
	}
}
