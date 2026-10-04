package ssherr_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"syscall"
	"testing"

	"github.com/pkg/sftp"

	"github.com/mode777/stratofold/internal/ssherr"
)

func TestClassify(t *testing.T) {
	permStatus := &sftp.StatusError{Code: uint32(sftp.ErrSSHFxPermissionDenied)}
	lostStatus := &sftp.StatusError{Code: uint32(sftp.ErrSSHFxConnectionLost)}
	_, netErr := net.Dial("tcp", "127.0.0.1:1") // connection refused
	wrapped := fmt.Errorf("transfer: %w", lostStatus)

	cases := []struct {
		name string
		err  error
		want ssherr.Class
	}{
		{"nil is permanent", nil, ssherr.Permanent},
		{"host key mismatch", ssherr.HostKeyMismatch("a", "b"), ssherr.Permanent},
		{"wrapped host key mismatch", fmt.Errorf("dial: %w", ssherr.HostKeyMismatch("a", "b")), ssherr.Permanent},
		{"context canceled", context.Canceled, ssherr.Permanent},
		{"context deadline", context.DeadlineExceeded, ssherr.Permanent},
		{"resume impossible", ssherr.ErrResumeImpossible, ssherr.Permanent},
		{"permission status", permStatus, ssherr.Permanent},
		{"os permission (normalized)", os.ErrPermission, ssherr.Permanent},
		{"os not exist (normalized)", os.ErrNotExist, ssherr.Permanent},
		{"connection lost status", lostStatus, ssherr.Retryable},
		{"wrapped retryable", wrapped, ssherr.Retryable},
		{"io EOF", io.EOF, ssherr.Retryable},
		{"unexpected EOF", io.ErrUnexpectedEOF, ssherr.Retryable},
		{"conn refused", netErr, ssherr.Retryable},
		{"econnreset", syscall.ECONNRESET, ssherr.Retryable},
		{"unknown is retryable", errors.New("mystery"), ssherr.Retryable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ssherr.Classify(tc.err); got != tc.want {
				t.Fatalf("Classify(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}
