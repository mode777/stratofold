// Package publicurls owns the pretty public URL surface: the vdir
// public-name validation hook, the session-free alias resolver, and the
// /apps/<name> browse/file routes.
package publicurls

import (
	"database/sql"
	"errors"

	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
)

const (
	// Collection is the vdir collection that owns the public name.
	Collection = "vdirs"
	// SlugField is the optional globally unique public name.
	SlugField = "public_slug"
	// NameField is the display name returned by the resolver.
	NameField = "name"
)

// ErrSlugTaken is the field-level duplicate-name validation error. The
// API serializes it under data.public_slug so the SPA can distinguish a
// conflict from an unrelated 400; the partial unique index remains the
// race backstop.
func slugTakenError() error {
	return validation.Errors{
		SlugField: validation.NewError("validation_not_unique", "This public name is already taken."),
	}
}

// Register binds the duplicate-name validation hook. It joins the same
// pre-serve hook position as the other record registries (connreg), so
// every record-API and app-internal save is covered.
func Register(app core.App) {
	app.OnRecordValidate(Collection).BindFunc(func(e *core.RecordEvent) error {
		slug := e.Record.GetString(SlugField)
		if slug == "" {
			return e.Next()
		}

		filter := "public_slug = {:slug}"
		params := map[string]any{"slug": slug}
		if e.Record.Id != "" {
			filter += " && id != {:id}"
			params["id"] = e.Record.Id
		}
		other, err := e.App.FindFirstRecordByFilter(Collection, filter, params)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return e.Next()
			}
			return err
		}
		if other != nil {
			return slugTakenError()
		}
		return e.Next()
	})
}
