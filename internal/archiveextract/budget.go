package archiveextract

import "io"

// memberReadError marks an error produced by reading a member's own
// bytes, as opposed to an error writing to the remote. Archive-side
// failures (a ceiling breach, a checksum mismatch, a broken stream) are
// facts about the file and must never be retried as if the connection
// were flaky; the transfer's classifier uses this marker.
type memberReadError struct{ err error }

func (e *memberReadError) Error() string { return e.err.Error() }
func (e *memberReadError) Unwrap() error { return e.err }

// budgetReader enforces the inflated-bytes ceiling (design D7). It reads
// through from the archive and fails with ErrBudget the moment the stream
// would deliver one byte past the remaining allowance. The declared size
// in the archive's central directory is never trusted, because it is
// attacker-controlled.
type budgetReader struct {
	r         io.Reader
	remaining int64
}

func newBudgetReader(r io.Reader, remaining int64) *budgetReader {
	return &budgetReader{r: r, remaining: remaining}
}

func (b *budgetReader) Read(p []byte) (int, error) {
	n, err := b.read(p)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return n, &memberReadError{err: err}
	}
	return n, err
}

func (b *budgetReader) read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if b.remaining <= 0 {
		// Exactly at the ceiling is fine if the entry ends here: probe
		// one byte to tell EOF from overflow.
		var probe [1]byte
		n, err := b.r.Read(probe[:])
		if n > 0 {
			return 0, ErrBudget
		}
		if err != nil {
			return 0, err
		}
		return 0, io.EOF
	}
	if int64(len(p)) > b.remaining {
		p = p[:b.remaining]
	}
	n, err := b.r.Read(p)
	b.remaining -= int64(n)
	return n, err
}
