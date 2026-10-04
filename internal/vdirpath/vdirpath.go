// Package vdirpath resolves virtual paths lexically against a vdir
// root: the result is always a canonical, root-anchored relative path,
// or the input is rejected (design D4). Backslashes are ordinary
// filename characters (POSIX SFTP semantics), so backslash-based
// segments can never traverse. Percent-decoding is the HTTP layer's
// responsibility (changes 4–5 must pass decoded paths).
package vdirpath

import (
	"errors"
	"strings"
)

// ErrOutsideRoot reports a path that would climb above the vdir root.
var ErrOutsideRoot = errors.New("vdirpath: path escapes the vdir root")

// ErrInvalidPath reports a path that can never address anything (null
// bytes) or an absolute form (a virtual path is root-relative).
var ErrInvalidPath = errors.New("vdirpath: invalid virtual path")

// Resolve lexically normalizes the virtual path and returns the
// canonical path relative to the vdir root. The empty result denotes
// the root itself. No remote I/O happens here.
func Resolve(virtual string) (string, error) {
	if strings.ContainsRune(virtual, '\x00') {
		return "", ErrInvalidPath
	}
	if strings.HasPrefix(virtual, "/") {
		return "", ErrInvalidPath
	}

	parts := strings.Split(virtual, "/")
	clean := make([]string, 0, len(parts))
	for _, p := range parts {
		switch p {
		case "", ".":
			continue
		case "..":
			if len(clean) == 0 {
				return "", ErrOutsideRoot
			}
			clean = clean[:len(clean)-1]
		default:
			clean = append(clean, p)
		}
	}
	return strings.Join(clean, "/"), nil
}
