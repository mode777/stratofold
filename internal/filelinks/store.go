// Package filelinks implements temporary, per-file read links (the
// file-links capability): an authenticated reader mints a link for one
// virtual path, and the session-free /s/<token> route serves exactly
// that file for 24 hours or until the creator's access disappears.
// Tokens are stored only as a SHA-256 hash; the plaintext appears once,
// in the mint response.
package filelinks

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	// LinkTTL is the fixed lifetime of a minted link (design D6).
	LinkTTL = 24 * time.Hour

	// tokenBytes is the raw entropy per token (256 bits); base64url
	// encoding yields 43 URL-safe characters.
	tokenBytes = 32

	// collection is the PocketBase collection holding one row per link.
	collection = "file_links"
)

// newToken returns a fresh cryptographically random token.
func newToken() (string, error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// hashToken is the at-rest representation of a token. A fast hash is
// enough because the token is high-entropy (design D2).
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// createLink stores one link row and returns the record plus the
// once-only plaintext token.
func createLink(app core.App, vdirID, virtualPath, userID string, now time.Time) (*core.Record, string, error) {
	token, err := newToken()
	if err != nil {
		return nil, "", err
	}
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		return nil, "", err
	}
	rec := core.NewRecord(col)
	rec.Set("vdir", vdirID)
	rec.Set("path", virtualPath)
	rec.Set("created_by", userID)
	rec.Set("token_hash", hashToken(token))
	expiresAt, err := types.ParseDateTime(now.Add(LinkTTL))
	if err != nil {
		return nil, "", err
	}
	rec.Set("expires_at", expiresAt)
	if err := app.Save(rec); err != nil {
		return nil, "", err
	}
	return rec, token, nil
}

// findLinkByToken looks a link up by its plaintext token. The caller
// treats every error (including no rows) as not-found.
func findLinkByToken(app core.App, token string) (*core.Record, error) {
	return app.FindFirstRecordByFilter(collection, "token_hash = {:hash}", dbx.Params{
		"hash": hashToken(token),
	})
}

// sweepExpired deletes rows whose expiry has passed. It is called best
// effort on mint; a failure never fails the mint (design D10).
func sweepExpired(app core.App, now time.Time) error {
	_, err := app.DB().
		NewQuery("DELETE FROM file_links WHERE expires_at < {:now}").
		Bind(dbx.Params{"now": now.UTC().Format(types.DefaultDateLayout)}).
		Execute()
	return err
}
