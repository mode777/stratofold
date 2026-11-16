package archiveextract

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"os"
)

// defaultReadAhead is the window size design D3 settles on: large enough
// to cover a member's local header plus a typical small member, small
// enough that a job's footprint is irrelevant next to its transfer window.
const defaultReadAhead = 1 << 20

// zipSignatures are the local-file-header, end-of-central-directory, and
// spanned-archive markers. A source that starts with none of them is
// refused before any scan work.
var zipSignatures = [][]byte{
	{'P', 'K', 0x03, 0x04},
	{'P', 'K', 0x05, 0x06},
	{'P', 'K', 0x07, 0x08},
}

// Sniff verifies that the remote file at the transfer's path begins like
// a zip archive. It is the content check behind "a path that is not an
// archive is refused" — the extension alone is not evidence.
func Sniff(ctx context.Context, tr rangedReader) error {
	head, err := tr.ReadRange(ctx, 0, 4)
	if err != nil {
		return err
	}
	for _, sig := range zipSignatures {
		if bytes.Equal(head, sig) {
			return nil
		}
	}
	return fmt.Errorf("%w: the file is not a zip archive", ErrUnsupportedArchive)
}

// Open reads the archive's directory through the ranged reader and
// returns it for extraction. It performs no decompression yet, so a
// malformed archive fails here as an unsupported-archive error.
func Open(ctx context.Context, tr rangedReader, size int64) (*zip.Reader, error) {
	if size < 22 {
		return nil, fmt.Errorf("%w: %d bytes is too small to be a zip archive", ErrUnsupportedArchive, size)
	}
	ra := NewWindowReaderAt(NewReaderAt(ctx, tr, size), defaultReadAhead)
	zr, err := zip.NewReader(ra, size)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnsupportedArchive, err)
	}
	return zr, nil
}

// CheckSupported refuses members this change cannot decode (design D4):
// encrypted entries and compression methods other than store/deflate.
func CheckSupported(f *zip.File) error {
	if f.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%w: entry %q is a symbolic link", ErrUnsafeEntry, f.Name)
	}
	if f.Flags&0x1 != 0 {
		return fmt.Errorf("%w: entry %q is encrypted", ErrUnsupportedArchive, f.Name)
	}
	switch f.Method {
	case zip.Store, zip.Deflate:
		return nil
	default:
		return fmt.Errorf("%w: entry %q uses unsupported compression method %d", ErrUnsupportedArchive, f.Name, f.Method)
	}
}
