package fileserver

import "testing"

// TestMIMETableVideoEntries pins the extension set the SPA classifies
// as video, including the two added by add-video-player, and the
// unknown-extension default.
func TestMIMETableVideoEntries(t *testing.T) {
	cases := map[string]string{
		"movie.mp4":  "video/mp4",
		"movie.m4v":  "video/mp4",
		"movie.webm": "video/webm",
		"movie.ogv":  "video/ogg",
		"movie.mov":  "video/quicktime",
		"movie.xyz":  "application/octet-stream",
	}
	for name, want := range cases {
		if got := contentType(name); got != want {
			t.Errorf("contentType(%q) = %q, want %q", name, got, want)
		}
	}
}
