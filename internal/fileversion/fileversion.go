// Package fileversion derives the opaque content version shared by
// listings, single-path stat, the file server's ETag, and conditional
// uploads, and owns the durable per-(vdir, path) publication counter
// that makes a same-size upload in the same whole second observable.
//
// The version is deliberately not a content hash: metadata operations
// never read file bytes. It combines the sandbox's resolved remote
// path, the connection, the remote signature (kind, size, whole-second
// mtime), and the publication generation. External SFTP edits are
// detected when that signature changes; a same-size edit that also
// preserves the whole-second mtime remains the documented residual.
package fileversion

import (
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Collection is the internal PocketBase collection holding publication
// counters. It has no record-API rules.
const Collection = "file_versions"

// ErrStore marks a failure of the version store itself (missing table,
// database error). API handlers map it to 500; it is never disguised as
// a missing file and is not retried as a remote operation.
var ErrStore = errors.New("fileversion: version store unavailable")

// Version derives the current opaque version for a resolved remote
// path. The caller must pass the connection id from the same
// vdir.Resolution that produced remotePath.
func Version(app core.App, vdirID, connectionID, remotePath string, fi os.FileInfo) (string, error) {
	gen, err := Generation(app, vdirID, remotePath)
	if err != nil {
		return "", err
	}
	return Hash(vdirID, connectionID, remotePath, fi, gen), nil
}

// Hash derives the opaque version from already-fetched inputs. It is
// used by listings that batch their generation lookup and by tests.
// The 16-byte truncation keeps the validator short while leaving the
// collision probability negligible.
func Hash(vdirID, connectionID, remotePath string, fi os.FileInfo, generation int64) string {
	kind := "file"
	if fi.IsDir() {
		kind = "directory"
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{
		"stratofold-file-version",
		vdirID,
		connectionID,
		remotePath,
		kind,
		strconv.FormatInt(fi.Size(), 10),
		strconv.FormatInt(fi.ModTime().Unix(), 10),
		strconv.FormatInt(generation, 10),
	}, "\x00")))
	return "v1-" + base64.RawURLEncoding.EncodeToString(sum[:16])
}

// JoinRemote returns the canonical remote path of an entry directly
// under dir. The sandbox represents the remote root as "", so this is
// not path.Join: path.Join("", "a") would lose the leading slash.
func JoinRemote(dir, name string) string {
	if dir == "" {
		return "/" + name
	}
	return strings.TrimRight(dir, "/") + "/" + name
}

// Entry is one directory-listing row used for a batched version fill.
type Entry struct {
	Name string
	Info os.FileInfo
}

// VersionsForDir derives versions for one directory listing with a
// single batched generation lookup. The result is keyed by entry name.
func VersionsForDir(app core.App, vdirID, connectionID, dirRemotePath string, entries []Entry) (map[string]string, error) {
	out := make(map[string]string, len(entries))
	if len(entries) == 0 {
		return out, nil
	}
	paths := make([]string, len(entries))
	for i, en := range entries {
		paths[i] = JoinRemote(dirRemotePath, en.Name)
	}
	gens, err := GenerationsForPaths(app, vdirID, paths)
	if err != nil {
		return nil, err
	}
	for i, en := range entries {
		out[en.Name] = Hash(vdirID, connectionID, paths[i], en.Info, gens[paths[i]])
	}
	return out, nil
}

// Generation returns the publication counter for remotePath, or 0 when
// the path has never been published through Stratofold.
func Generation(app core.App, vdirID, remotePath string) (int64, error) {
	var gen int64
	err := app.DB().
		NewQuery("SELECT generation FROM file_versions WHERE vdir = {:vdir} AND remote_path = {:path}").
		Bind(dbx.Params{"vdir": vdirID, "path": remotePath}).
		Row(&gen)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("%w: generation lookup: %w", ErrStore, err)
	}
	return gen, nil
}

// GenerationsForPaths returns the counters for many paths under one
// vdir. Missing paths are absent from the map (callers treat them as
// 0). The IN list is chunked to stay below SQLite's parameter limit.
func GenerationsForPaths(app core.App, vdirID string, paths []string) (map[string]int64, error) {
	out := make(map[string]int64, len(paths))
	const chunkSize = 500
	for start := 0; start < len(paths); start += chunkSize {
		end := start + chunkSize
		if end > len(paths) {
			end = len(paths)
		}
		params := dbx.Params{"vdir": vdirID}
		placeholders := make([]string, 0, end-start)
		for i := start; i < end; i++ {
			key := "p" + strconv.Itoa(i)
			params[key] = paths[i]
			placeholders = append(placeholders, "{:"+key+"}")
		}
		query := "SELECT remote_path, generation FROM file_versions WHERE vdir = {:vdir} AND remote_path IN (" +
			strings.Join(placeholders, ",") + ")"
		rows, err := app.DB().NewQuery(query).Bind(params).Rows()
		if err != nil {
			return nil, fmt.Errorf("%w: batch generation lookup: %w", ErrStore, err)
		}
		for rows.Next() {
			var path string
			var gen int64
			if err := rows.Scan(&path, &gen); err != nil {
				rows.Close()
				return nil, fmt.Errorf("%w: scan generation: %w", ErrStore, err)
			}
			out[path] = gen
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("%w: batch generation rows: %w", ErrStore, err)
		}
		rows.Close()
	}
	return out, nil
}

// Bump atomically increments (or creates) the publication counter and
// returns the new generation. It is the reservation the upload publish
// path persists before its rename.
func Bump(app core.App, vdirID, remotePath string) (int64, error) {
	var gen int64
	err := app.DB().NewQuery(`
		INSERT INTO file_versions (vdir, remote_path, generation)
		VALUES ({:vdir}, {:path}, 1)
		ON CONFLICT (vdir, remote_path) DO UPDATE SET generation = generation + 1
		RETURNING generation`).
		Bind(dbx.Params{"vdir": vdirID, "path": remotePath}).
		Row(&gen)
	if err != nil {
		return 0, fmt.Errorf("%w: bump: %w", ErrStore, err)
	}
	return gen, nil
}

// Rollback decrements a reservation only when the row still holds that
// exact generation, so a concurrent publication is never undone.
func Rollback(app core.App, vdirID, remotePath string, reservation int64) error {
	_, err := app.DB().NewQuery(`
		UPDATE file_versions
		SET generation = generation - 1
		WHERE vdir = {:vdir} AND remote_path = {:path} AND generation = {:gen}`).
		Bind(dbx.Params{"vdir": vdirID, "path": remotePath, "gen": reservation}).
		Execute()
	if err != nil {
		return fmt.Errorf("%w: rollback: %w", ErrStore, err)
	}
	return nil
}
