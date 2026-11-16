package archiveextract

import (
	"context"
	"fmt"
	"io"
)

// rangedReader is the slice of a transfer this package needs: exact
// ranged reads that already survive reconnects. *sftpreadwrite.Transfer
// implements it; tests inject a fake.
type rangedReader interface {
	ReadRange(ctx context.Context, off int64, length int) ([]byte, error)
	ReadRangeTo(ctx context.Context, w io.Writer, off, length int64) (int64, error)
}

// ReaderAt adapts a remote file to io.ReaderAt through ranged, retried
// SFTP reads (design D3), so archive/zip can seek around the archive
// without the host ever holding a copy of it.
type ReaderAt struct {
	ctx  context.Context
	r    rangedReader
	size int64
}

// NewReaderAt returns a ReaderAt over r for a file of size bytes.
func NewReaderAt(ctx context.Context, r rangedReader, size int64) *ReaderAt {
	return &ReaderAt{ctx: ctx, r: r, size: size}
}

// Size is the file's total length.
func (r *ReaderAt) Size() int64 { return r.size }

// ReadAt implements io.ReaderAt. A read that reaches the end of the file
// returns io.EOF with the bytes that were available, which is the
// contract archive/zip relies on.
func (r *ReaderAt) ReadAt(p []byte, off int64) (int, error) {
	if off < 0 {
		return 0, fmt.Errorf("archiveextract: negative offset %d", off)
	}
	if len(p) == 0 {
		return 0, nil
	}
	if off >= r.size {
		return 0, io.EOF
	}
	want := len(p)
	if int64(want) > r.size-off {
		want = int(r.size - off)
	}
	buf, err := r.r.ReadRange(r.ctx, off, want)
	if err != nil {
		return 0, err
	}
	n := copy(p, buf)
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}

// WindowReaderAt serves ReadAt calls from a bounded read-ahead window
// (design D3): a zip reads a member's local header and then streams its
// data immediately after it, so one window usually covers a whole small
// member and collapses several round trips into one. The window is a
// prefetch, not a cache — it holds at most one bounded span and never the
// whole archive.
type WindowReaderAt struct {
	base *ReaderAt
	size int

	start int64
	buf   []byte
	n     int
	valid bool
}

// NewWindowReaderAt wraps base with a window of windowSize bytes.
func NewWindowReaderAt(base *ReaderAt, windowSize int) *WindowReaderAt {
	if windowSize < 1 {
		windowSize = 1
	}
	return &WindowReaderAt{base: base, size: windowSize, buf: make([]byte, windowSize)}
}

// Size is the underlying file's total length.
func (w *WindowReaderAt) Size() int64 { return w.base.Size() }

// ReadAt implements io.ReaderAt over the window.
func (w *WindowReaderAt) ReadAt(p []byte, off int64) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	// A request at least as large as the window gains nothing from it.
	if off < 0 || len(p) >= w.size {
		return w.base.ReadAt(p, off)
	}
	if !w.fits(off, len(p)) {
		if err := w.refill(off); err != nil {
			return 0, err
		}
		if !w.fits(off, len(p)) {
			// The window cannot cover the request (it would straddle
			// EOF); the base reader owns the exact io.ReaderAt
			// contract, including io.EOF.
			return w.base.ReadAt(p, off)
		}
	}
	rel := off - w.start
	return copy(p, w.buf[rel:rel+int64(len(p))]), nil
}

// fits reports whether the window fully covers [off, off+n).
func (w *WindowReaderAt) fits(off int64, n int) bool {
	return w.valid && off >= w.start && off+int64(n) <= w.start+int64(w.n)
}

// refill loads the window starting at off, clamped to the file's end.
func (w *WindowReaderAt) refill(off int64) error {
	w.valid = false
	w.n = 0
	w.start = off
	if off >= w.base.Size() {
		return nil
	}
	want := w.size
	if rem := w.base.Size() - off; rem < int64(want) {
		want = int(rem)
	}
	sw := &sliceWriter{b: w.buf[:want]}
	if _, err := w.base.r.ReadRangeTo(w.base.ctx, sw, off, int64(want)); err != nil {
		return err
	}
	w.n = sw.written
	w.valid = true
	return nil
}

// sliceWriter fills a preallocated slice without growing it; a short
// destination is a hard error rather than silent truncation.
type sliceWriter struct {
	b       []byte
	written int
}

func (s *sliceWriter) Write(p []byte) (int, error) {
	n := copy(s.b, p)
	s.b = s.b[n:]
	s.written += n
	if n < len(p) {
		return n, io.ErrShortWrite
	}
	return n, nil
}
