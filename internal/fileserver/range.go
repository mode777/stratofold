package fileserver

import (
	"strings"
)

// rangeKind is how a Range header resolves against a file size.
type rangeKind int

const (
	// rangeFull: no Range header, or one we ignore (design D5) —
	// serve the whole file with 200.
	rangeFull rangeKind = iota
	// rangePartial: a satisfiable single byte range — serve 206.
	rangePartial
	// rangeUnsatisfiable: well-formed but impossible — serve 416.
	rangeUnsatisfiable
)

// parseRange applies the strict single-range grammar (design D5):
// `bytes=start-end`, `bytes=start-`, `bytes=-suffix`. It returns the
// served window [start, start+length) clamped to size. Anything
// unparseable or unhonorable (foreign unit, multiple ranges, malformed
// numbers, start > end) degrades to the full file; well-formed but
// impossible requests (start >= size, `-0`) are unsatisfiable.
func parseRange(header string, size int64) (start, length int64, kind rangeKind) {
	const unit = "bytes="
	if header == "" || !strings.HasPrefix(header, unit) {
		return 0, size, rangeFull
	}
	spec := strings.TrimSpace(header[len(unit):])
	if spec == "" || strings.Contains(spec, ",") {
		return 0, size, rangeFull // multiple ranges are ignored, not an error
	}

	// Suffix form: last N bytes.
	if spec[0] == '-' {
		n, ok := parseUint(spec[1:])
		if !ok {
			return 0, size, rangeFull
		}
		if n == 0 {
			return 0, 0, rangeUnsatisfiable
		}
		if n > size {
			n = size
		}
		return size - n, n, rangePartial
	}

	dash := strings.IndexByte(spec, '-')
	if dash < 0 {
		return 0, size, rangeFull // no end and no suffix: malformed
	}
	s, ok := parseUint(spec[:dash])
	if !ok {
		return 0, size, rangeFull
	}
	if s >= size {
		return 0, 0, rangeUnsatisfiable
	}
	end := size - 1
	if ePart := spec[dash+1:]; ePart != "" {
		e, ok := parseUint(ePart)
		if !ok {
			return 0, size, rangeFull
		}
		if e < s {
			return 0, size, rangeFull // invalid spec poisons the whole header
		}
		if e >= size {
			e = size - 1
		}
		end = e
	}
	return s, end - s + 1, rangePartial
}

// parseUint parses a non-negative decimal integer (digits only, no
// sign, no spaces). Overflowing values report false — they are treated
// as malformed (ignored) rather than clamped.
func parseUint(s string) (int64, bool) {
	if s == "" {
		return 0, false
	}
	var n int64
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < '0' || c > '9' {
			return 0, false
		}
		d := int64(c - '0')
		if n > (1<<63-1-d)/10 {
			return 0, false
		}
		n = n*10 + d
	}
	return n, true
}
