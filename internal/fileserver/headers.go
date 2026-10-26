package fileserver

import (
	"fmt"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

// mimeTypes is the built-in, deterministic extension→Content-Type
// table (design D4). Deterministic across hosts: no environment mime
// databases are consulted. Extensions are matched lowercased; the
// default is application/octet-stream.
var mimeTypes = map[string]string{
	".html":  "text/html",
	".htm":   "text/html",
	".css":   "text/css",
	".js":    "text/javascript",
	".mjs":   "text/javascript",
	".json":  "application/json",
	".txt":   "text/plain",
	".csv":   "text/csv",
	".pdf":   "application/pdf",
	".png":   "image/png",
	".jpg":   "image/jpeg",
	".jpeg":  "image/jpeg",
	".gif":   "image/gif",
	".webp":  "image/webp",
	".svg":   "image/svg+xml",
	".ico":   "image/x-icon",
	".avif":  "image/avif",
	".mp4":   "video/mp4",
	".m4v":   "video/mp4",
	".webm":  "video/webm",
	".ogv":   "video/ogg",
	".mov":   "video/quicktime",
	".mp3":   "audio/mpeg",
	".ogg":   "audio/ogg",
	".wav":   "audio/wav",
	".flac":  "audio/flac",
	".wasm":  "application/wasm",
	".xml":   "application/xml",
	".zip":   "application/zip",
	".gz":    "application/gzip",
	".tar":   "application/x-tar",
	".woff":  "font/woff",
	".woff2": "font/woff2",
	".ttf":   "font/ttf",
}

// contentType maps a file name to its Content-Type (by extension of
// the virtual name the client addressed).
func contentType(name string) string {
	ext := strings.ToLower(path.Ext(name))
	if ct, ok := mimeTypes[ext]; ok {
		return ct
	}
	return "application/octet-stream"
}

// httpTime formats an instant as an HTTP-date (RFC 9110).
func httpTime(t time.Time) string {
	return t.UTC().Format(http.TimeFormat)
}

// entityTag derives a strong ETag from the remote stat (design D4):
// size and modification second, hex-encoded, quoted.
func entityTag(st os.FileInfo) string {
	return fmt.Sprintf(`"%x-%x"`, st.Size(), st.ModTime().Unix())
}

// notModified evaluates the conditional request headers (design D4):
// a matching If-None-Match (opaque comparison, `*` matches anything)
// takes precedence over If-Modified-Since; a Last-Modified at or after
// If-Modified-Since counts as unmodified.
func notModified(r *http.Request, st os.FileInfo, etag string) bool {
	if inm := r.Header.Get("If-None-Match"); strings.TrimSpace(inm) != "" {
		return ifNoneMatchMatches(inm, etag)
	}
	if ims := r.Header.Get("If-Modified-Since"); ims != "" {
		t, err := http.ParseTime(ims)
		if err != nil {
			return false
		}
		return !st.ModTime().Truncate(time.Second).After(t)
	}
	return false
}

// ifNoneMatchMatches reports whether the header's tag list matches the
// current entity tag. Weak tags compare by their opaque part.
func ifNoneMatchMatches(header, etag string) bool {
	if strings.TrimSpace(header) == "*" {
		return true
	}
	want := opaqueTag(etag)
	for _, part := range strings.Split(header, ",") {
		if opaqueTag(part) == want {
			return true
		}
	}
	return false
}

// opaqueTag normalizes an entity-tag to its opaque value: whitespace,
// an optional weakness prefix, and the quotes are stripped.
func opaqueTag(tag string) string {
	tag = strings.TrimSpace(tag)
	tag = strings.TrimPrefix(tag, "W/")
	return strings.Trim(tag, `"`)
}
