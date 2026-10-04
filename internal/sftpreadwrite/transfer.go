// Package sftpreadwrite implements byte-exact, offset-based reads and
// writes over SFTP with transparent resume after connection drops:
// the operation layer owns retries (docs/architecture.md, failure and
// retry model). Chunks are pipelined with a bounded in-flight window;
// progress bookkeeping is the contiguous acknowledged prefix, so a
// resume point is always gap-free.
package sftpreadwrite

import (
	"context"
	"fmt"
	"io"
	"math"
	"os"
	"sync"

	"github.com/pkg/sftp"

	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/ssherr"
)

const (
	// DefaultChunkSize bounds the per-chunk buffer (pkg/sftp's max
	// packet size).
	DefaultChunkSize = 32 * 1024
	// DefaultInFlight bounds the pipelining window; memory per
	// transfer stays ~2x InFlight x ChunkSize regardless of file size.
	DefaultInFlight = 32
	// DefaultMaxAttempts bounds reconnect cycles per logical transfer;
	// exhausting it fails loudly.
	DefaultMaxAttempts = 8
)

// Options shape transfers. All fields are optional.
type Options struct {
	ChunkSize   int
	InFlight    int
	MaxAttempts int
	// Classifier overrides ssherr.Classify (tests inject tables).
	Classifier func(error) ssherr.Class
}

func (o Options) withDefaults() Options {
	if o.ChunkSize <= 0 {
		o.ChunkSize = DefaultChunkSize
	}
	if o.InFlight <= 0 {
		o.InFlight = DefaultInFlight
	}
	if o.MaxAttempts <= 0 {
		o.MaxAttempts = DefaultMaxAttempts
	}
	if o.Classifier == nil {
		o.Classifier = ssherr.Classify
	}
	return o
}

// Transfer streams one remote path through a ClientProvider.
type Transfer struct {
	p    sshconn.ClientProvider
	path string
	opt  Options
}

// New returns a Transfer for path over p.
func New(p sshconn.ClientProvider, path string, opts Options) *Transfer {
	return &Transfer{p: p, path: path, opt: opts.withDefaults()}
}

// ReadRange reads exactly length bytes starting at off. A short remote
// file fails with io.ErrUnexpectedEOF.
func (t *Transfer) ReadRange(ctx context.Context, off int64, length int) ([]byte, error) {
	var out []byte
	n, err := t.readInto(ctx, off, int64(length), func(b []byte) error {
		out = append(out, b...)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if n != int64(length) {
		return nil, fmt.Errorf("sftpreadwrite: read %s: short read at offset %d: got %d bytes, want %d: %w",
			t.path, off, n, length, io.ErrUnexpectedEOF)
	}
	return out, nil
}

// ReadAll streams the whole file to w in bounded chunks, resuming at
// the last served offset across connection drops.
func (t *Transfer) ReadAll(ctx context.Context, w io.Writer) (int64, error) {
	return t.readInto(ctx, 0, -1, func(b []byte) error {
		_, err := w.Write(b)
		return err
	})
}

// ReadN streams exactly n bytes from the start of the file to w (a
// bounded ReadAll). A short remote file fails with io.ErrUnexpectedEOF.
func (t *Transfer) ReadN(ctx context.Context, w io.Writer, n int64) (int64, error) {
	return t.readInto(ctx, 0, n, func(b []byte) error {
		_, err := w.Write(b)
		return err
	})
}

// ReadRangeTo streams exactly length bytes starting at the absolute
// offset off to w — the streaming ranged read behind HTTP Range
// responses. A short remote range fails with io.ErrUnexpectedEOF.
// Retryable failures reconnect and resume at the last sink-confirmed
// offset, so w receives a gap-free, non-repeated byte sequence across
// connection drops.
func (t *Transfer) ReadRangeTo(ctx context.Context, w io.Writer, off, length int64) (int64, error) {
	if off < 0 || length < 0 {
		return 0, fmt.Errorf("sftpreadwrite: read %s: negative off (%d) or length (%d)", t.path, off, length)
	}
	n, err := t.readInto(ctx, off, length, func(b []byte) error {
		_, err := w.Write(b)
		return err
	})
	if err == nil && n != length {
		return n, fmt.Errorf("sftpreadwrite: read %s: short read at offset %d: got %d bytes, want %d: %w",
			t.path, off, n, length, io.ErrUnexpectedEOF)
	}
	return n, err
}

// WriteAll streams r to the remote file: the first attempt creates and
// truncates the target, later attempts resume at the last acknowledged
// offset. size < 0 means "until reader EOF". Returns the number of
// bytes confirmed written (contiguous prefix).
func (t *Transfer) WriteAll(ctx context.Context, r io.Reader, size int64) (int64, error) {
	var acked int64
	var replay [][]byte
	first := true

	for attempt := 1; attempt <= t.opt.MaxAttempts; attempt++ {
		cl, release, err := t.p.Client(ctx)
		if err != nil {
			return acked, err
		}

		flags := os.O_WRONLY
		if first {
			flags |= os.O_CREATE | os.O_TRUNC
		}
		f, err := cl.OpenFile(t.path, flags)
		if err != nil {
			release()
			if t.opt.Classifier(err) == ssherr.Permanent {
				return acked, fmt.Errorf("sftpreadwrite: open %s for write: %w", t.path, err)
			}
			t.p.Invalidate(cl)
			continue
		}

		if !first {
			if err := t.guard(cl, acked); err != nil {
				f.Close()
				release()
				return acked, err
			}
		}

		adv, newReplay, done, err := t.pipelineWrite(ctx, f, acked, replay, r, size)
		f.Close()
		release()
		replay = newReplay
		acked += adv

		first = false
		if done {
			return acked, nil
		}
		if err != nil {
			if t.opt.Classifier(err) == ssherr.Permanent || ctx.Err() != nil {
				return acked, fmt.Errorf("sftpreadwrite: write %s at offset %d: %w", t.path, acked, err)
			}
			t.p.Invalidate(cl) // retryable: resume at the acked prefix
			continue
		}
	}
	return acked, fmt.Errorf("sftpreadwrite: write %s: transfer failed after %d attempts (acked %d bytes)",
		t.path, t.opt.MaxAttempts, acked)
}

// WriteChunkAt writes data at the absolute offset off of an existing
// file without truncating it (offset patch). The remote file must
// cover the offset — a patch never extends it. Retryable failures
// reconnect and rewrite the same chunk at the same offset — idempotent
// because the patch content is fixed. Returns bytes written.
func (t *Transfer) WriteChunkAt(ctx context.Context, off int64, data []byte) (int64, error) {
	for attempt := 1; attempt <= t.opt.MaxAttempts; attempt++ {
		cl, release, err := t.p.Client(ctx)
		if err != nil {
			return 0, err
		}
		if err := t.guard(cl, off); err != nil {
			release()
			return 0, err
		}
		f, err := cl.OpenFile(t.path, os.O_WRONLY)
		if err != nil {
			release()
			if t.opt.Classifier(err) == ssherr.Permanent {
				return 0, fmt.Errorf("sftpreadwrite: open %s for write: %w", t.path, err)
			}
			t.p.Invalidate(cl)
			continue
		}
		wn, werr := f.WriteAt(data, off)
		f.Close()
		release()
		if werr == nil && wn == len(data) {
			return int64(wn), nil
		}
		if werr != nil {
			if t.opt.Classifier(werr) == ssherr.Permanent || ctx.Err() != nil {
				return int64(wn), fmt.Errorf("sftpreadwrite: write %s at offset %d: %w", t.path, off, werr)
			}
		}
		t.p.Invalidate(cl)
	}
	return 0, fmt.Errorf("sftpreadwrite: write %s: chunk write at %d failed after %d attempts",
		t.path, off, t.opt.MaxAttempts)
}

// guard verifies the remote file still covers offset — i.e. it was not
// truncated or replaced under the transfer. A mismatch fails loudly
// instead of silently corrupting the target.
func (t *Transfer) guard(cl *sftp.Client, offset int64) error {
	if offset == 0 {
		return nil
	}
	st, err := cl.Stat(t.path)
	if err != nil {
		return fmt.Errorf("sftpreadwrite: stat %s for resume: %w", t.path, err)
	}
	if st.Size() < offset {
		return fmt.Errorf("sftpreadwrite: %s: %w (remote size %d, resume offset %d)",
			t.path, ssherr.ErrResumeImpossible, st.Size(), offset)
	}
	return nil
}

// ---- pipelined read ----

// eofTracker records the last chunk index that yielded data (workers
// discover EOF concurrently; the minimum wins).
type eofTracker struct {
	mu  sync.Mutex
	set bool
	idx int64
}

func (e *eofTracker) mark(idx int64) {
	e.mu.Lock()
	if !e.set || idx < e.idx {
		e.set = true
		e.idx = idx
	}
	e.mu.Unlock()
}

func (e *eofTracker) last() (int64, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.idx, e.set
}

type readResult struct {
	idx int64
	n   int
	buf []byte
	err error
}

// readInto serves bytes starting at off into sink until EOF (length <
// 0) or exactly length bytes were served.
func (t *Transfer) readInto(ctx context.Context, off, length int64, sink func([]byte) error) (int64, error) {
	var served int64

	for attempt := 1; attempt <= t.opt.MaxAttempts; attempt++ {
		cl, release, err := t.p.Client(ctx)
		if err != nil {
			return served, err
		}
		if attempt > 1 {
			if err := t.guard(cl, served); err != nil {
				release()
				return served, err
			}
		}
		f, err := cl.Open(t.path)
		if err != nil {
			release()
			if t.opt.Classifier(err) == ssherr.Permanent {
				return served, fmt.Errorf("sftpreadwrite: open %s: %w", t.path, err)
			}
			t.p.Invalidate(cl) // retryable: reconnect and resume at served
			continue
		}

		got, done, err := t.pipelineRead(ctx, f, off+served, length-served, sink)
		f.Close()
		release()
		served += got

		if done {
			return served, nil
		}
		if err != nil {
			if t.opt.Classifier(err) == ssherr.Permanent || ctx.Err() != nil {
				return served, fmt.Errorf("sftpreadwrite: read %s at offset %d: %w", t.path, served, err)
			}
			t.p.Invalidate(cl) // retryable: resume at served
			continue
		}
	}
	return served, fmt.Errorf("sftpreadwrite: read %s: transfer failed after %d attempts (served %d bytes)",
		t.path, t.opt.MaxAttempts, served)
}

// pipelineRead streams chunks starting at remote offset start,
// delivering to sink in order. limit < 0 = until EOF. Returns bytes
// delivered (contiguous, sink-confirmed), whether the stream is
// complete, and the error if incomplete.
func (t *Transfer) pipelineRead(ctx context.Context, f *sftp.File, start, limit int64, sink func([]byte) error) (int64, bool, error) {
	if limit == 0 {
		return 0, true, nil
	}
	pctx, cancel := context.WithCancel(ctx)
	defer cancel()

	chunk := int64(t.opt.ChunkSize)
	inflight := t.opt.InFlight
	pool := newBufPool(int(chunk))

	eof := &eofTracker{}
	maxIdx := int64(math.MaxInt64)
	if limit > 0 {
		maxIdx = (limit - 1) / chunk // last chunk index containing requested bytes
	}

	tasks := make(chan int64)
	results := make(chan readResult, inflight)
	var wg sync.WaitGroup
	for i := 0; i < inflight; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range tasks {
				buf := pool.get()
				readLen := int64(len(buf))
				if limit > 0 {
					if rem := limit - idx*chunk; rem < readLen {
						readLen = rem
					}
				}
				n, rerr := f.ReadAt(buf[:readLen], start+idx*chunk)
				res := readResult{idx: idx, n: n, buf: buf}
				switch {
				case rerr == nil:
					if int64(n) < readLen {
						eof.mark(idx)
					}
				case rerr == io.EOF && n > 0:
					eof.mark(idx)
				case rerr == io.EOF && n == 0:
					eof.mark(idx - 1)
					pool.put(buf)
					res.buf = nil
				default:
					res.err = rerr
					pool.put(buf)
					res.buf = nil
					cancel()
				}
				results <- res
			}
		}()
	}

	// Feeder: dispatch chunk indices until EOF is known, the limit is
	// covered, or the pipeline dies.
	go func() {
		defer close(tasks)
		for idx := int64(0); ; idx++ {
			if last, known := eof.last(); known && idx > last {
				return
			}
			if idx > maxIdx {
				return
			}
			select {
			case tasks <- idx:
			case <-pctx.Done():
				return
			}
		}
	}()
	go func() {
		wg.Wait()
		close(results)
	}()

	// Deliver in order; sink errors abort the attempt.
	var delivered int64
	pending := make(map[int64]readResult, inflight)
	expected := int64(0)

	drainOne := func() (done bool, err error) {
		for {
			r, ok := pending[expected]
			if !ok {
				return false, nil
			}
			delete(pending, expected)
			expected++
			if r.err != nil {
				return false, r.err
			}
			if r.n > 0 {
				if serr := sink(r.buf[:r.n]); serr != nil {
					pool.put(r.buf)
					return false, serr
				}
				delivered += int64(r.n)
			}
			if r.buf != nil {
				pool.put(r.buf)
			}
			if last, known := eof.last(); known && expected > last {
				return true, nil
			}
			if limit >= 0 && delivered >= limit {
				return true, nil
			}
		}
	}

	for r := range results {
		// Store every result, including n==0 EOF markers: they satisfy
		// the contiguous walk below (files that are exact chunk
		// multiples end with such a marker).
		pending[r.idx] = r
		done, err := drainOne()
		if done || err != nil {
			// Keep draining until the workers wind down, or their
			// sends block forever.
			go func() {
				for range results {
				}
			}()
			return delivered, done, err
		}
		if ctx.Err() != nil {
			go func() {
				for range results {
				}
			}()
			return delivered, false, ctx.Err()
		}
	}
	return delivered, false, fmt.Errorf("sftpreadwrite: pipeline ended prematurely at offset %d", start+delivered)
}

// ---- pipelined write ----

type writeResult struct {
	idx  int64
	n    int
	err  error
	data []byte
}

// pipelineWrite streams r to f starting at remote offset start with a
// bounded in-flight window. replay holds bytes already pulled from r in
// previous attempts (offsets start..start+len(replay)); it is fed
// first, then r. Results return their data slices so every pulled byte
// is either acknowledged (returned to the pool) or carried in the
// returned replay for the next attempt — a reconnect can never write
// the wrong bytes at the resume point.
//
// Returns the contiguous acknowledged advance, the replay for the next
// attempt, whether the input was fully acknowledged, and the first
// error if not.
func (t *Transfer) pipelineWrite(ctx context.Context, f *sftp.File, start int64, replay [][]byte, r io.Reader, size int64) (int64, [][]byte, bool, error) {
	pctx, cancel := context.WithCancel(ctx)
	defer cancel()

	chunk := int64(t.opt.ChunkSize)
	inflight := t.opt.InFlight
	pool := newBufPool(int(chunk))

	type task struct {
		idx  int64
		data []byte
	}
	tasks := make(chan task, inflight)
	results := make(chan writeResult, inflight)

	var mu sync.Mutex
	dispatched := int64(0) // bytes successfully handed to workers
	dispatchedCount := func() int64 {
		mu.Lock()
		defer mu.Unlock()
		return dispatched
	}
	finished := false // feeder done (EOF, size reached, or reader error)
	readerErr := error(nil)
	carried := []byte(nil) // pulled-but-unsent chunk (r already advanced)

	var feederWg sync.WaitGroup
	feederWg.Add(1)
	go func() {
		defer feederWg.Done()
		defer close(tasks)
		idx := int64(0)
		send := func(data []byte) bool {
			select {
			case tasks <- task{idx: idx, data: data}:
				idx++
				mu.Lock()
				dispatched += int64(len(data))
				mu.Unlock()
				return true
			case <-pctx.Done():
				// The reader position already moved past data; carry
				// it for the next attempt instead of losing it.
				mu.Lock()
				carried = data
				mu.Unlock()
				return false
			}
		}
		for _, d := range replay {
			if !send(d) {
				return
			}
		}
		for {
			// Respect the declared size: never pull beyond the bytes
			// the caller asked to write (readers may be infinite).
			remaining := int64(-1)
			if size >= 0 {
				remaining = size - start - int64(dispatchedCount())
				if remaining <= 0 {
					mu.Lock()
					finished = true
					mu.Unlock()
					return
				}
			}
			buf := pool.get()
			readLen := int64(len(buf))
			if remaining >= 0 && remaining < readLen {
				readLen = remaining
			}
			n, rerr := io.ReadFull(r, buf[:readLen])
			if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
				mu.Lock()
				finished = true
				mu.Unlock()
				if n > 0 {
					if !send(buf[:n]) {
						return
					}
				} else {
					pool.put(buf)
				}
				return
			}
			if rerr != nil {
				mu.Lock()
				readerErr = rerr
				finished = true
				mu.Unlock()
				cancel() // abort the pipeline; surfaced below
				pool.put(buf)
				return
			}
			// rerr == nil implies n == readLen, but slice to n anyway:
			// never send bytes beyond what the reader produced.
			if !send(buf[:n]) {
				return
			}
		}
	}()

	var wg sync.WaitGroup
	for i := 0; i < inflight; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for tk := range tasks {
				_, werr := f.WriteAt(tk.data, start+tk.idx*chunk)
				// Data returns with the result: either acked (pooled)
				// or carried into the replay for the next attempt.
				results <- writeResult{idx: tk.idx, n: len(tk.data), err: werr, data: tk.data}
				if werr != nil {
					cancel()
				}
			}
		}()
	}
	go func() {
		feederWg.Wait()
		wg.Wait()
		close(results)
	}()

	var acked int64 // contiguous acknowledged prefix (this attempt)
	ackedIdx := int64(-1)
	pending := make(map[int64]writeResult, inflight)
	firstErr := error(nil)
	done := false

	for wr := range results {
		pending[wr.idx] = wr
		for {
			p, ok := pending[ackedIdx+1]
			if !ok {
				break
			}
			if p.err != nil {
				if firstErr == nil {
					firstErr = p.err
				}
				break // stop advancing past the failure
			}
			delete(pending, ackedIdx+1)
			acked += int64(p.n)
			ackedIdx++
			pool.put(p.data)
		}
		if firstErr == nil {
			mu.Lock()
			fin, disp, rerr := finished, dispatched, readerErr
			mu.Unlock()
			if fin && acked >= disp {
				done = true
				if rerr != nil && firstErr == nil {
					firstErr = rerr
				}
			}
		}
	}

	// Every pulled-but-unacked byte becomes the replay for the next
	// attempt, in offset order: dispatched-but-unacked results first,
	// then the carried (pulled-but-unsent) chunk.
	var newReplay [][]byte
	for idx := ackedIdx + 1; ; idx++ {
		p, ok := pending[idx]
		if !ok {
			break
		}
		newReplay = append(newReplay, p.data)
	}
	mu.Lock()
	carriedCopy := carried
	mu.Unlock()
	if carriedCopy != nil {
		newReplay = append(newReplay, carriedCopy)
	}

	if firstErr != nil {
		return acked, newReplay, false, fmt.Errorf("sftpreadwrite: write %s: %w", t.path, firstErr)
	}
	if !done {
		return acked, newReplay, false, ctx.Err()
	}
	return acked, nil, true, nil
}

// ---- buffer pool ----

type bufPool struct {
	pool sync.Pool
}

func newBufPool(size int) *bufPool {
	return &bufPool{pool: sync.Pool{New: func() any {
		return make([]byte, size)
	}}}
}

func (p *bufPool) get() []byte { return p.pool.Get().([]byte) }

func (p *bufPool) put(b []byte) {
	if b != nil {
		p.pool.Put(b[:cap(b)])
	}
}
