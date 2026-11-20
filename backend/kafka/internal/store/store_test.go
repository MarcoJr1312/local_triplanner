package store

import (
	"context"
	"path/filepath"
	"testing"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "broker.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func TestPublishFetchAck(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()

	first, err := st.Publish(ctx, "TripInvitation", "evt-1", []byte(`{"type":"trip.invitation"}`))
	if err != nil {
		t.Fatalf("publish first: %v", err)
	}
	second, err := st.Publish(ctx, "TripInvitation", "evt-2", []byte(`{"type":"trip.invitation"}`))
	if err != nil {
		t.Fatalf("publish second: %v", err)
	}
	if second <= first {
		t.Fatalf("expected increasing offsets, got %d and %d", first, second)
	}

	messages, err := st.Fetch(ctx, "email-service", "TripInvitation", 10)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(messages))
	}
	if messages[0].Key != "evt-1" || string(messages[0].Value) != `{"type":"trip.invitation"}` {
		t.Fatalf("unexpected first message: %+v", messages[0])
	}

	if err := st.Ack(ctx, "email-service", "TripInvitation", first); err != nil {
		t.Fatalf("ack: %v", err)
	}
	messages, err = st.Fetch(ctx, "email-service", "TripInvitation", 10)
	if err != nil {
		t.Fatalf("fetch after ack: %v", err)
	}
	if len(messages) != 1 || messages[0].Offset != second {
		t.Fatalf("expected only the second message, got %+v", messages)
	}
}

func TestConsumersHaveIndependentOffsets(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()

	if _, err := st.Publish(ctx, "TripInvitation", "evt-1", []byte(`{"ok":true}`)); err != nil {
		t.Fatalf("publish: %v", err)
	}
	if err := st.Ack(ctx, "consumer-a", "TripInvitation", 1); err != nil {
		t.Fatalf("ack a: %v", err)
	}

	a, err := st.Fetch(ctx, "consumer-a", "TripInvitation", 10)
	if err != nil {
		t.Fatalf("fetch a: %v", err)
	}
	if len(a) != 0 {
		t.Fatalf("consumer-a should be caught up, got %d", len(a))
	}

	b, err := st.Fetch(ctx, "consumer-b", "TripInvitation", 10)
	if err != nil {
		t.Fatalf("fetch b: %v", err)
	}
	if len(b) != 1 {
		t.Fatalf("consumer-b should see the message, got %d", len(b))
	}
}

func TestAckIsMonotonic(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()

	if err := st.Ack(ctx, "email-service", "TripInvitation", 5); err != nil {
		t.Fatalf("ack 5: %v", err)
	}
	if err := st.Ack(ctx, "email-service", "TripInvitation", 2); err != nil {
		t.Fatalf("ack 2: %v", err)
	}
	offset, err := st.NextOffset(ctx, "email-service", "TripInvitation")
	if err != nil {
		t.Fatalf("next offset: %v", err)
	}
	if offset != 6 {
		t.Fatalf("expected next offset 6, got %d", offset)
	}
}
