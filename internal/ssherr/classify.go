// Package ssherr classifies SSH/SFTP errors as retryable or permanent.
package ssherr

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"syscall"

	"github.com/pkg/sftp"
)

// Class is the retryability of an error.
type Class int

const (
	// Retryable errors stem from transport/network trouble; the
	// operation may be retried after reconnection.
	Retryable Class = iota
	// Permanent errors are semantic (permission, not found, host key
	// mismatch, caller cancellation); they must never be retried.
	Permanent
)

// ErrHostKeyMismatch is returned when the remote host key does not
// match the pinned fingerprint.
var ErrHostKeyMismatch = errors.New("ssherr: host key mismatch")

// ErrConfiguration reports a connection configuration that cannot be
// used (e.g. credentials that cannot be unsealed); retrying can never
// help, so it classifies as permanent.
var ErrConfiguration = errors.New("ssherr: unusable connection configuration")

// HostKeyMismatch builds the pinned-fingerprint mismatch error.
func HostKeyMismatch(got, want string) error {
	return fmt.Errorf("%w: got %s, want %s", ErrHostKeyMismatch, got, want)
}

// ErrResumeImpossible reports that a stream cannot resume because the
// remote file changed under the transfer (e.g. truncated externally).
// The transfer failed loudly; the remote file must not be assumed
// intact.
var ErrResumeImpossible = errors.New("ssherr: transfer cannot resume: remote file changed")

// Classify maps an error to its retryability class. Unknown errors are
// conservatively Retryable; callers bound retries with an attempt
// limit so a genuinely broken transfer still fails loudly.
func Classify(err error) Class {
	if err == nil {
		return Permanent
	}
	if errors.Is(err, ErrHostKeyMismatch) {
		return Permanent
	}
	if errors.Is(err, ErrConfiguration) {
		return Permanent
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return Permanent
	}
	if errors.Is(err, ErrResumeImpossible) {
		return Permanent
	}

	var statusErr *sftp.StatusError
	if errors.As(err, &statusErr) {
		switch statusErr.FxCode() {
		case sftp.ErrSSHFxPermissionDenied, sftp.ErrSSHFxNoSuchFile, sftp.ErrSSHFxOpUnsupported:
			return Permanent
		default:
			return Retryable
		}
	}

	if errors.Is(err, os.ErrPermission) || errors.Is(err, os.ErrNotExist) {
		// pkg/sftp normalizes these SFTP statuses into os errors.
		return Permanent
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		return Retryable
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return Retryable
	}

	if errors.Is(err, io.EOF) ||
		errors.Is(err, io.ErrUnexpectedEOF) ||
		errors.Is(err, io.ErrClosedPipe) ||
		errors.Is(err, os.ErrClosed) ||
		errors.Is(err, syscall.ECONNRESET) ||
		errors.Is(err, syscall.ECONNREFUSED) ||
		errors.Is(err, syscall.EPIPE) ||
		errors.Is(err, syscall.ETIMEDOUT) {
		return Retryable
	}

	return Retryable
}

// IsPermanent reports whether err must never be retried.
func IsPermanent(err error) bool { return Classify(err) == Permanent }
