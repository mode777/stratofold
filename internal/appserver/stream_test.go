package appserver_test

import (
	"bytes"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/appserver"
	"github.com/mode777/stratofold/internal/testapp"
)

const (
	shortWriteTimeout = 300 * time.Millisecond
	streamPause       = 800 * time.Millisecond
	firstChunk        = "FIRST-CHUNK"
	finalChunk        = "FINAL-CHUNK"
)

func streamHandler(e *core.RequestEvent) error {
	e.Response.Header().Set("Content-Type", "text/plain")
	if _, err := e.Response.Write([]byte(firstChunk)); err != nil {
		return err
	}
	rc := http.NewResponseController(e.Response)
	_ = rc.Flush()
	time.Sleep(streamPause)
	_, err := e.Response.Write([]byte(finalChunk))
	return err
}

func withStreamRoutes() testapp.Option {
	return testapp.WithApp(func(app core.App) {
		app.OnServe().BindFunc(func(se *core.ServeEvent) error {
			se.Router.GET("/api/sf/stream-clear", streamHandler).BindFunc(appserver.ClearStreamDeadlines())
			se.Router.GET("/api/sf/stream-plain", streamHandler)
			return se.Next()
		})
	})
}

func TestStreamDeadlineClearingSurvivesServerWriteTimeout(t *testing.T) {
	s := testapp.Start(t,
		testapp.WithOptions(func(o *appserver.Options) {
			o.Timeouts = &appserver.TimeoutConfig{
				Read:       shortWriteTimeout,
				Write:      shortWriteTimeout,
				ReadHeader: time.Minute,
				Idle:       2 * time.Minute,
			}
		}),
		withStreamRoutes(),
	)

	clearResp, clearErr := get(t, s.BaseURL+"/api/sf/stream-clear")
	if clearErr != nil {
		t.Fatalf("stream with cleared deadlines: %v", clearErr)
	}
	if !bytes.Contains(clearResp, []byte(firstChunk)) || !bytes.Contains(clearResp, []byte(finalChunk)) {
		t.Fatalf("stream with cleared deadlines: incomplete body %q", clearResp)
	}

	plainResp, plainErr := get(t, s.BaseURL+"/api/sf/stream-plain")
	if plainErr == nil && bytes.Contains(plainResp, []byte(finalChunk)) {
		t.Fatalf("stream without deadline clearing outlived the %s write timeout: got %q, want truncated/error", shortWriteTimeout, plainResp)
	}
	if bytes.Contains(plainResp, []byte(finalChunk)) {
		t.Fatalf("stream without deadline clearing delivered the final chunk: %q", plainResp)
	}
}

func get(t *testing.T, url string) ([]byte, error) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(resp.Body)
	return body, readErr
}
