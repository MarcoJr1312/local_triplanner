package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"triplanner/backend/kafka/internal/store"
)

func newServer(t *testing.T) *httptest.Server {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "broker.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	server := httptest.NewServer(New(st, logger))
	t.Cleanup(server.Close)
	return server
}

func postJSON(t *testing.T, url string, body []byte) *http.Response {
	t.Helper()
	response, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("post %s: %v", url, err)
	}
	return response
}

func decode(t *testing.T, response *http.Response, value any) {
	t.Helper()
	defer response.Body.Close()
	if err := json.NewDecoder(response.Body).Decode(value); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}

func TestPublishFetchAck(t *testing.T) {
	server := newServer(t)

	response := postJSON(t, server.URL+"/v1/topics/TripInvitation/messages", []byte(`{"key":"evt-1","value":{"hello":"world"}}`))
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("publish status: %d", response.StatusCode)
	}
	var published struct {
		Offset int64 `json:"offset"`
	}
	decode(t, response, &published)
	if published.Offset <= 0 {
		t.Fatalf("expected an offset, got %d", published.Offset)
	}

	response, err := http.Get(server.URL + "/v1/topics/TripInvitation/messages?consumer=email-service&limit=10")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	var fetched struct {
		Messages []struct {
			Offset int64           `json:"offset"`
			Key    string          `json:"key"`
			Value  json.RawMessage `json:"value"`
		} `json:"messages"`
	}
	decode(t, response, &fetched)
	if len(fetched.Messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(fetched.Messages))
	}
	if string(fetched.Messages[0].Value) != `{"hello":"world"}` {
		t.Fatalf("unexpected value: %s", fetched.Messages[0].Value)
	}

	ackBody, _ := json.Marshal(map[string]any{"consumer": "email-service", "offset": published.Offset})
	response = postJSON(t, server.URL+"/v1/topics/TripInvitation/ack", ackBody)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("ack status: %d", response.StatusCode)
	}
	response.Body.Close()

	response, err = http.Get(server.URL + "/v1/topics/TripInvitation/messages?consumer=email-service&limit=10")
	if err != nil {
		t.Fatalf("fetch after ack: %v", err)
	}
	fetched.Messages = nil
	decode(t, response, &fetched)
	if len(fetched.Messages) != 0 {
		t.Fatalf("expected no messages after ack, got %d", len(fetched.Messages))
	}
}

func TestRejectsInvalidJSON(t *testing.T) {
	server := newServer(t)
	response := postJSON(t, server.URL+"/v1/topics/TripInvitation/messages", []byte(`{"value":`))
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.StatusCode)
	}
}

func TestRejectsInvalidTopic(t *testing.T) {
	server := newServer(t)
	response := postJSON(t, server.URL+"/v1/topics/bad%20topic/messages", []byte(`{"value":{"ok":true}}`))
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.StatusCode)
	}
}
