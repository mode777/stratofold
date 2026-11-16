package archiveextract

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

// State is a job's lifecycle state. A job ends in exactly one terminal
// state.
type State string

const (
	StateRunning   State = "running"
	StateSucceeded State = "succeeded"
	StateFailed    State = "failed"
	StateCanceled  State = "canceled"
)

// Phase is the stage a running job is in.
type Phase string

const (
	PhaseScanning   Phase = "scanning"
	PhaseExtracting Phase = "extracting"
	PhasePublishing Phase = "publishing"
)

// JobError is a terminal failure with the API error class it belongs to.
// After a job is accepted the response status was already 202, so the
// status travels here instead (design D10).
type JobError struct {
	Status  int    `json:"status"`
	Message string `json:"message"`
}

// Snapshot is one observation of a job.
type Snapshot struct {
	ID      string `json:"id"`
	State   State  `json:"state"`
	Phase   Phase  `json:"phase"`
	Path    string `json:"path"`
	Target  string `json:"target"`
	Skipped int    `json:"skipped"`

	EntriesTotal int   `json:"entriesTotal"`
	EntriesDone  int   `json:"entriesDone"`
	BytesTotal   int64 `json:"bytesTotal"`
	BytesDone    int64 `json:"bytesDone"`

	CurrentEntry string     `json:"currentEntry,omitempty"`
	Error        *JobError  `json:"error,omitempty"`
	StartedAt    time.Time  `json:"startedAt"`
	FinishedAt   *time.Time `json:"finishedAt,omitempty"`

	// vdirID scopes observation; never serialized.
	vdirID string
}

// Job is one running or finished extraction. Immutable fields are read
// without the lock.
type Job struct {
	id        string
	vdirID    string
	targetKey string

	mu       sync.Mutex
	snap     Snapshot
	finished bool

	cancel context.CancelFunc
	done   chan struct{}
}

// Snapshot returns the current observation.
func (j *Job) Snapshot() Snapshot {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.snap
}

// Done is closed when the job reaches a terminal state.
func (j *Job) Done() <-chan struct{} { return j.done }

func (j *Job) setPhase(p Phase) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.snap.State == StateRunning {
		j.snap.Phase = p
	}
}

func (j *Job) setTotals(entries int, bytes int64) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.snap.EntriesTotal = entries
	j.snap.BytesTotal = bytes
}

func (j *Job) setSkipped(n int) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.snap.Skipped = n
}

func (j *Job) entryStarted(name string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.snap.CurrentEntry = name
}

func (j *Job) entryDone(bytes int64) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.snap.EntriesDone++
	j.snap.BytesDone += bytes
	j.snap.CurrentEntry = ""
}

// Registry owns the process's jobs (design D2: in-memory only — a
// restart abandons them).
type Registry struct {
	mu      sync.Mutex
	jobs    map[string]*Job
	targets map[string]bool
	running int
	now     func() time.Time
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{jobs: map[string]*Job{}, targets: map[string]bool{}, now: time.Now}
}

var defaultRegistry = NewRegistry()

// Default is the process-wide registry the API routes use.
func Default() *Registry { return defaultRegistry }

// Start registers a job and runs it in the background. It refuses with
// ErrBusy when the concurrency budget is spent and with
// ErrAlreadyRunning when the same target is already being extracted
// (design D8) — never queueing silently.
func (r *Registry) Start(ctx context.Context, vdirID string, snap Snapshot, targetKey string, run func(ctx context.Context, j *Job) error) (*Job, error) {
	id, err := newJobID()
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	r.evictLocked()
	if r.running >= MaxConcurrentJobs {
		r.mu.Unlock()
		return nil, fmt.Errorf("%w: %d jobs already running", ErrBusy, r.running)
	}
	if r.targets[targetKey] {
		r.mu.Unlock()
		return nil, fmt.Errorf("%w: this archive is already being extracted", ErrAlreadyRunning)
	}
	jobCtx, cancel := context.WithCancel(ctx)
	snap.vdirID = vdirID
	snap.ID = id
	snap.State = StateRunning
	snap.Phase = PhaseScanning
	snap.StartedAt = r.now()
	j := &Job{
		id:        id,
		vdirID:    vdirID,
		targetKey: targetKey,
		snap:      snap,
		cancel:    cancel,
		done:      make(chan struct{}),
	}
	r.jobs[id] = j
	r.targets[targetKey] = true
	r.running++
	r.mu.Unlock()

	go func() {
		defer func() {
			if p := recover(); p != nil {
				r.finish(j, StateFailed, &JobError{Status: 500, Message: fmt.Sprintf("extraction crashed: %v", p)})
			}
		}()
		err := run(jobCtx, j)
		switch {
		case err == nil:
			r.finish(j, StateSucceeded, nil)
		case errors.Is(err, context.Canceled), jobCtx.Err() != nil:
			r.finish(j, StateCanceled, nil)
		default:
			r.finish(j, StateFailed, &JobError{Status: jobStatus(err), Message: err.Error()})
		}
	}()
	return j, nil
}

// Lookup returns the snapshot of one job belonging to vdirID.
func (r *Registry) Lookup(vdirID, id string) (Snapshot, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.evictLocked()
	j, ok := r.jobs[id]
	if !ok || j.vdirID != vdirID {
		return Snapshot{}, false
	}
	return j.Snapshot(), true
}

// Cancel stops a running job and waits up to wait for it to settle, so a
// DELETE normally reports the terminal state. Canceling a finished job is
// a no-op that reports its existing state (idempotent).
func (r *Registry) Cancel(ctx context.Context, vdirID, id string, wait time.Duration) (Snapshot, bool) {
	r.mu.Lock()
	j, ok := r.jobs[id]
	r.mu.Unlock()
	if !ok || j.vdirID != vdirID {
		return Snapshot{}, false
	}
	select {
	case <-j.done:
		return j.Snapshot(), true
	default:
	}
	j.cancel()
	if wait <= 0 {
		return j.Snapshot(), true
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-j.done:
	case <-timer.C:
	case <-ctx.Done():
	}
	return j.Snapshot(), true
}

// finish records a terminal state exactly once and frees the job's slots.
func (r *Registry) finish(j *Job, state State, jerr *JobError) {
	j.mu.Lock()
	if j.finished {
		j.mu.Unlock()
		return
	}
	j.finished = true
	now := r.now()
	j.snap.State = state
	j.snap.Error = jerr
	j.snap.FinishedAt = &now
	j.snap.CurrentEntry = ""
	j.mu.Unlock()

	j.cancel()
	r.mu.Lock()
	delete(r.targets, j.targetKey)
	r.running--
	r.mu.Unlock()
	close(j.done)
}

// evictLocked drops terminal jobs whose retention window has passed.
// Eviction never touches published output — it forgets a result, it does
// not undo one.
func (r *Registry) evictLocked() {
	cutoff := r.now().Add(-JobRetention)
	for id, j := range r.jobs {
		snap := j.Snapshot()
		if snap.FinishedAt != nil && snap.FinishedAt.Before(cutoff) {
			delete(r.jobs, id)
		}
	}
}

// newJobID returns a 128-bit random job id.
func newJobID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("archiveextract: job id: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}
