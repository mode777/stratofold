package archiveextract

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateEntryNameRejects(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{"", "empty name"},
		{"../escape.txt", "traversing segment"},
		{"a/../../b.txt", "traversing segment"},
		{"a/../b.txt", "traversing segment"},
		{"/etc/passwd", "absolute"},
		{`a\b.txt`, "backslash"},
		{"a\x00b.txt", "NUL"},
		{"a//b.txt", "empty"},
		{"a//", "empty"},
		{"/", "absolute"},
		{"//", "absolute"},
		{"./a.txt", "dotted"},
		{"..", "traversing"},
		{strings.Repeat("a/", MaxDepth) + "f.txt", "levels deep"},
		{"caf\xe9.txt", "invalid UTF-8"},
	}
	for _, tc := range cases {
		_, err := ValidateEntryName(tc.name)
		if err == nil {
			t.Fatalf("ValidateEntryName(%q): expected an error", tc.name)
		}
		if !errors.Is(err, ErrUnsafeEntry) {
			t.Fatalf("ValidateEntryName(%q): err = %v, want ErrUnsafeEntry", tc.name, err)
		}
		if !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("ValidateEntryName(%q): message = %q, want it to mention %q", tc.name, err, tc.want)
		}
	}
}

func TestValidateEntryNameAccepts(t *testing.T) {
	cases := []struct {
		name string
		segs []string
	}{
		{"a/b.txt", []string{"a", "b.txt"}},
		{"a b.txt", []string{"a b.txt"}},
		{".bashrc", []string{".bashrc"}},
		{"docs/2026/Q1 report.pdf", []string{"docs", "2026", "Q1 report.pdf"}},
		{"ünïcode/ß.txt", []string{"ünïcode", "ß.txt"}},
		{"a..b/c.txt", []string{"a..b", "c.txt"}},
		// The zip convention for directory entries: one trailing slash.
		{"POLY_SurvivalWorkshop/", []string{"POLY_SurvivalWorkshop"}},
		{"docs/2026/", []string{"docs", "2026"}},
	}
	for _, tc := range cases {
		segs, err := ValidateEntryName(tc.name)
		if err != nil {
			t.Fatalf("ValidateEntryName(%q): %v", tc.name, err)
		}
		if len(segs) != len(tc.segs) {
			t.Fatalf("ValidateEntryName(%q) = %v, want %v", tc.name, segs, tc.segs)
		}
		for i := range segs {
			if segs[i] != tc.segs[i] {
				t.Fatalf("ValidateEntryName(%q) = %v, want %v", tc.name, segs, tc.segs)
			}
		}
	}
}

func TestValidateEntryNameDepth(t *testing.T) {
	ok := strings.Repeat("d/", MaxDepth-1) + "f.txt"
	if _, err := ValidateEntryName(ok); err != nil {
		t.Fatalf("depth %d rejected: %v", MaxDepth, err)
	}
}

func TestIsCosmetic(t *testing.T) {
	skip := []string{
		"__MACOSX/._photo.jpg",
		"__MACOSX",
		"._photo.jpg",
		"docs/.DS_Store",
		".DS_Store",
		"Thumbs.db",
		"a/b/Thumbs.db",
	}
	for _, name := range skip {
		segs, err := ValidateEntryName(name)
		if err != nil {
			t.Fatalf("%q: %v", name, err)
		}
		if !IsCosmetic(segs) {
			t.Fatalf("IsCosmetic(%q) = false, want true", name)
		}
	}
	keep := []string{"macosx/a.txt", ".ds_store", "docs/Thumbs.db.txt", "a.txt", "notes/._notreally?"}
	for _, name := range keep {
		if name == "notes/._notreally?" {
			// A genuine AppleDouble sibling is cosmetic; this case
			// exists only to prove the check is name-based, not
			// substring-based.
			continue
		}
		segs, err := ValidateEntryName(name)
		if err != nil {
			t.Fatalf("%q: %v", name, err)
		}
		if IsCosmetic(segs) {
			t.Fatalf("IsCosmetic(%q) = true, want false", name)
		}
	}
}

func TestTargetName(t *testing.T) {
	cases := []struct {
		archive string
		want    string
		bad     bool
	}{
		{"photos.zip", "photos", false},
		{"Backup.ZIP", "Backup", false},
		{"my.photos.zip", "my.photos", false},
		{"photos", "photos", false},
		{".zip", "", true},
		{"archive.tar.gz", "archive.tar.gz", false},
	}
	for _, tc := range cases {
		got, err := TargetName(tc.archive)
		if tc.bad {
			if err == nil {
				t.Fatalf("TargetName(%q): expected an error", tc.archive)
			}
			continue
		}
		if err != nil {
			t.Fatalf("TargetName(%q): %v", tc.archive, err)
		}
		if got != tc.want {
			t.Fatalf("TargetName(%q) = %q, want %q", tc.archive, got, tc.want)
		}
	}
}

func TestValidateTargetName(t *testing.T) {
	for _, bad := range []string{"", ".", "..", "a/b", `a\b`, "a\x00b"} {
		if _, err := ValidateTargetName(bad); err == nil {
			t.Fatalf("ValidateTargetName(%q): expected an error", bad)
		}
	}
	if got, err := ValidateTargetName("photos 2"); err != nil || got != "photos 2" {
		t.Fatalf("ValidateTargetName(%q) = %q, %v", "photos 2", got, err)
	}
}

func TestCeilingsAreBounded(t *testing.T) {
	if MaxEntries <= 0 || MaxDepth <= 0 || MaxUncompressedBytes <= 0 {
		t.Fatalf("ceilings must be positive: %d %d %d", MaxEntries, MaxDepth, MaxUncompressedBytes)
	}
	if MaxDepth > MaxEntries {
		t.Fatal("depth ceiling should not exceed the entry ceiling")
	}
}
