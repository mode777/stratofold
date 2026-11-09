// Package vdirtokens owns the storage and lifecycle of vdir-scoped
// bearer credentials (change add-vdir-access-tokens): token generation,
// hashing, storage/read helpers, expiry sweeps, and the best-effort
// last-used audit. The custom /api/sf/tokens routes and the shared
// request-auth seam are the only callers.
package vdirtokens

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	// Collection is the PocketBase collection holding one row per token.
	Collection = "vdir_tokens"

	// TokenPrefix makes tokens recognizable to users and secret scanners.
	TokenPrefix = "sf_v1_"

	// RoleViewer and RoleEditor are the only token roles.
	RoleViewer = "viewer"
	RoleEditor = "editor"

	// LastUsedThrottle bounds the audit write rate on a read path.
	LastUsedThrottle = 5 * time.Minute

	tokenBytes = 32
	sweepLimit = 100
)

// ErrNotFound is returned for an unknown or revoked token.
var ErrNotFound = errors.New("vdirtokens: token not found")

// ErrExpired is returned when a token exists but its expiry has passed.
var ErrExpired = errors.New("vdirtokens: token expired")

// Token is the in-memory view of a token row; it never contains the
// plaintext secret or its hash.
type Token struct {
	ID         string
	UserID     string
	VdirID     string
	Name       string
	Role       string
	Hint       string
	ExpiresAt  time.Time
	LastUsedAt time.Time
	Created    time.Time
}

// Expired reports whether the token's stored expiry has passed at now.
// A zero expiry means the token does not expire.
func (t *Token) Expired(now time.Time) bool {
	return !t.ExpiresAt.IsZero() && !now.Before(t.ExpiresAt)
}

// IsEditor reports whether the token carries the write-capable role.
func (t *Token) IsEditor() bool { return t.Role == RoleEditor }

// ValidRole reports whether role is one of the two supported roles.
func ValidRole(role string) bool { return role == RoleViewer || role == RoleEditor }

// NewToken returns a fresh plaintext token, its SHA-256 hash, and a
// non-secret display hint. The plaintext is 32 random bytes (256 bits)
// encoded base64url with the sf_v1_ prefix.
func NewToken() (plain, hash, hint string, err error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", "", "", err
	}
	plain = TokenPrefix + base64.RawURLEncoding.EncodeToString(b)
	hash = Hash(plain)
	rest := strings.TrimPrefix(plain, TokenPrefix)
	if len(rest) < 10 {
		return "", "", "", errors.New("vdirtokens: generated token is too short")
	}
	hint = TokenPrefix + rest[:6] + "…" + plain[len(plain)-4:]
	return plain, hash, hint, nil
}

// BearerToken extracts the credential from an Authorization header.
// The bool reports whether a Bearer scheme was present at all; an
// empty credential with true is malformed and must be rejected.
func BearerToken(header http.Header) (string, bool) {
	raw := header.Get("Authorization")
	const prefix = "Bearer "
	if len(raw) < len(prefix) || !strings.EqualFold(raw[:len(prefix)], prefix) {
		return "", false
	}
	return strings.TrimSpace(raw[len(prefix):]), true
}

// Hash is the at-rest representation of a token. SHA-256 is enough
// because the plaintext is high-entropy.
func Hash(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// FindByPlaintext resolves a plaintext token. Unknown, malformed, or
// revoked tokens are ErrNotFound; a present but expired token is
// ErrExpired. The caller maps both to unauthenticated.
func FindByPlaintext(app core.App, plain string) (*Token, error) {
	if plain == "" || !strings.HasPrefix(plain, TokenPrefix) {
		return nil, ErrNotFound
	}
	rec, err := app.FindFirstRecordByFilter(Collection, "token_hash = {:hash}", dbx.Params{
		"hash": Hash(plain),
	})
	if err != nil || rec == nil {
		return nil, ErrNotFound
	}
	tok := fromRecord(rec)
	if tok.Expired(time.Now().UTC()) {
		return nil, ErrExpired
	}
	return tok, nil
}

// FindByID loads a token without evaluating its expiry; callers that
// require a live token must check Token.Expired themselves.
func FindByID(app core.App, id string) (*Token, error) {
	rec, err := app.FindRecordById(Collection, id)
	if err != nil {
		return nil, ErrNotFound
	}
	return fromRecord(rec), nil
}

// ListByUser returns the user's tokens, newest first.
func ListByUser(app core.App, userID string) ([]*Token, error) {
	recs, err := app.FindRecordsByFilter(Collection, "user = {:user}", "", 0, 0,
		dbx.Params{"user": userID})
	if err != nil {
		return nil, err
	}
	out := make([]*Token, 0, len(recs))
	for _, rec := range recs {
		out = append(out, fromRecord(rec))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created.After(out[j].Created) })
	return out, nil
}

// Create stores a token row and returns the once-only plaintext.
// Validation of the vdir, role cap, and name length happens in the
// route; this helper only enforces the storage shape.
func Create(app core.App, userID, vdirID, name, role string, expiresAt time.Time) (*Token, string, error) {
	col, err := app.FindCollectionByNameOrId(Collection)
	if err != nil {
		return nil, "", err
	}
	plain, hash, hint, err := NewToken()
	if err != nil {
		return nil, "", err
	}
	rec := core.NewRecord(col)
	rec.Set("user", userID)
	rec.Set("vdir", vdirID)
	rec.Set("name", strings.TrimSpace(name))
	rec.Set("role", role)
	rec.Set("token_hash", hash)
	rec.Set("token_hint", hint)
	if !expiresAt.IsZero() {
		exp, err := types.ParseDateTime(expiresAt.UTC())
		if err != nil {
			return nil, "", err
		}
		rec.Set("expires_at", exp)
	}
	if err := app.Save(rec); err != nil {
		return nil, "", err
	}
	return fromRecord(rec), plain, nil
}

// Delete removes a token row (cascading its file links) and returns
// ErrNotFound when it does not exist.
func Delete(app core.App, id string) error {
	rec, err := app.FindRecordById(Collection, id)
	if err != nil {
		return ErrNotFound
	}
	return app.Delete(rec)
}

// SweepExpired deletes a bounded batch of expired tokens. Record
// deletes are used so the file_links cascade runs. Correctness never
// depends on this sweep: every lookup checks expiry.
func SweepExpired(app core.App, now time.Time) error {
	recs, err := app.FindRecordsByFilter(Collection,
		"expires_at != '' && expires_at < {:now}", "", sweepLimit, 0,
		dbx.Params{"now": now.UTC().Format(types.DefaultDateLayout)})
	if err != nil {
		return err
	}
	for _, rec := range recs {
		if err := app.Delete(rec); err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
	}
	return nil
}

// Touch records a successful use. It is best effort and coalesced to
// one write per LastUsedThrottle; the caller must not fail a request
// when it returns an error.
func Touch(app core.App, tok *Token, now time.Time) error {
	if tok == nil || tok.ID == "" {
		return nil
	}
	if !tok.LastUsedAt.IsZero() && now.Sub(tok.LastUsedAt) < LastUsedThrottle {
		return nil
	}
	_, err := app.DB().
		NewQuery("UPDATE vdir_tokens SET last_used_at = {:now} WHERE id = {:id}").
		Bind(dbx.Params{
			"now": now.UTC().Format(types.DefaultDateLayout),
			"id":  tok.ID,
		}).
		Execute()
	if err != nil {
		return err
	}
	tok.LastUsedAt = now.UTC()
	return nil
}

func fromRecord(rec *core.Record) *Token {
	return &Token{
		ID:         rec.Id,
		UserID:     rec.GetString("user"),
		VdirID:     rec.GetString("vdir"),
		Name:       rec.GetString("name"),
		Role:       rec.GetString("role"),
		Hint:       rec.GetString("token_hint"),
		ExpiresAt:  rec.GetDateTime("expires_at").Time(),
		LastUsedAt: rec.GetDateTime("last_used_at").Time(),
		Created:    rec.GetDateTime("created").Time(),
	}
}
