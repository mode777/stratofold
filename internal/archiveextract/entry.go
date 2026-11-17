package archiveextract

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// ValidateEntryName checks one archive member name against the strict
// extraction rules (design D4) and returns its segments. Unlike
// vdirpath.Resolve — which normalizes, because it guards user-typed
// virtual paths — nothing is rewritten here: an empty, "." or ".."
// segment, an absolute name, a backslash, a NUL byte, invalid UTF-8, or
// an over-deep path is refused, so two entries can never collapse onto
// one path and a hostile archive's intent is refused rather than erased.
// One trailing slash is the zip convention for a directory entry and is
// accepted: it is stripped before segment validation, so `docs/` is the
// directory `docs`, not an empty final segment.
func ValidateEntryName(name string) ([]string, error) {
	if name == "" {
		return nil, fmt.Errorf("%w: %w: empty name", ErrUnsafeEntry, errUnsafeName)
	}
	if !utf8.ValidString(name) {
		return nil, fmt.Errorf("%w: %w: %q has invalid UTF-8", ErrUnsafeEntry, errUnsafeName, name)
	}
	if strings.ContainsRune(name, 0) {
		return nil, fmt.Errorf("%w: %w: %q contains a NUL byte", ErrUnsafeEntry, errUnsafeName, name)
	}
	if strings.HasPrefix(name, "/") {
		return nil, fmt.Errorf("%w: %w: %q is absolute", ErrUnsafeEntry, errUnsafeName, name)
	}
	if strings.ContainsRune(name, '\\') {
		return nil, fmt.Errorf("%w: %w: %q contains a backslash", ErrUnsafeEntry, errUnsafeName, name)
	}
	segs := strings.Split(strings.TrimSuffix(name, "/"), "/")
	for _, s := range segs {
		switch s {
		case "", ".", "..":
			return nil, fmt.Errorf("%w: %w: %q has an empty, dotted, or traversing segment", ErrUnsafeEntry, errUnsafeName, name)
		}
	}
	if len(segs) > MaxDepth {
		return nil, fmt.Errorf("%w: %w: %q is %d levels deep (max %d)", ErrUnsafeEntry, errEntryDepth, name, len(segs), MaxDepth)
	}
	return segs, nil
}

// IsCosmetic reports archive metadata that is skipped rather than
// extracted (design D5): AppleDouble entries (__MACOSX trees and ._*
// siblings), .DS_Store, and Thumbs.db. An archive produced by an
// operating system is routinely full of these, so refusing them would
// make ordinary archives unusable.
func IsCosmetic(segs []string) bool {
	if len(segs) == 0 {
		return false
	}
	if segs[0] == "__MACOSX" {
		return true
	}
	base := segs[len(segs)-1]
	if base == ".DS_Store" || base == "Thumbs.db" {
		return true
	}
	return strings.HasPrefix(base, "._")
}

// TargetName derives the folder name for an archive: the archive's name
// with its .zip extension removed, matched case-insensitively
// (docs/photos.zip → photos).
func TargetName(archiveName string) (string, error) {
	name := archiveName
	if len(name) >= 4 && strings.EqualFold(name[len(name)-4:], ".zip") {
		name = name[:len(name)-4]
	}
	if name == "" {
		return "", fmt.Errorf("%w: archive name %q yields no folder name", ErrUnsafeEntry, archiveName)
	}
	return ValidateTargetName(name)
}

// ValidateTargetName checks an explicitly requested folder name: it must
// be one safe path segment, so a caller cannot aim the extraction at a
// nested path or above the archive's directory (design D4's rules applied
// to the override).
func ValidateTargetName(name string) (string, error) {
	if name == "" || name == "." || name == ".." {
		return "", fmt.Errorf("%w: invalid target name %q", ErrUnsafeEntry, name)
	}
	if !utf8.ValidString(name) {
		return "", fmt.Errorf("%w: target name %q has invalid UTF-8", ErrUnsafeEntry, name)
	}
	if strings.ContainsAny(name, "/\\") || strings.ContainsRune(name, 0) {
		return "", fmt.Errorf("%w: target name %q must be a single path segment", ErrUnsafeEntry, name)
	}
	return name, nil
}
