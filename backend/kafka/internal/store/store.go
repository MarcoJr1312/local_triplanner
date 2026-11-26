// Package store is the durable log behind the demo broker.
//
// SQLite is intentional: one container, one writer, no external database. The
// API is a Kafka-like topic/offset/ack surface, not the Kafka wire protocol.
package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type Message struct {
	Offset int64
	Key    string
	Value  []byte
}

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("configure sqlite: %w", err)
	}
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS messages (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			topic      TEXT NOT NULL,
			key        TEXT NOT NULL DEFAULT '',
			value      TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS messages_topic_id ON messages(topic, id);
		CREATE TABLE IF NOT EXISTS consumer_offsets (
			consumer    TEXT NOT NULL,
			topic       TEXT NOT NULL,
			next_offset INTEGER NOT NULL DEFAULT 0,
			updated_at  TEXT NOT NULL,
			PRIMARY KEY (consumer, topic)
		);
	`); err != nil {
		db.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

func (s *Store) Publish(ctx context.Context, topic, key string, value []byte) (int64, error) {
	result, err := s.db.ExecContext(
		ctx,
		`INSERT INTO messages(topic, key, value, created_at) VALUES (?, ?, ?, ?)`,
		topic,
		key,
		string(value),
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return 0, fmt.Errorf("insert message: %w", err)
	}
	offset, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("read message offset: %w", err)
	}
	return offset, nil
}

func (s *Store) NextOffset(ctx context.Context, consumer, topic string) (int64, error) {
	var offset int64
	err := s.db.QueryRowContext(
		ctx,
		`SELECT COALESCE((SELECT next_offset FROM consumer_offsets WHERE consumer = ? AND topic = ?), 0)`,
		consumer,
		topic,
	).Scan(&offset)
	if err != nil {
		return 0, fmt.Errorf("read consumer offset: %w", err)
	}
	return offset, nil
}

func (s *Store) Fetch(ctx context.Context, consumer, topic string, limit int) ([]Message, error) {
	offset, err := s.NextOffset(ctx, consumer, topic)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, key, value FROM messages WHERE topic = ? AND id >= ? ORDER BY id ASC LIMIT ?`,
		topic,
		offset,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch messages: %w", err)
	}
	defer rows.Close()

	messages := make([]Message, 0, limit)
	for rows.Next() {
		var message Message
		var value string
		if err := rows.Scan(&message.Offset, &message.Key, &value); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		message.Value = []byte(value)
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate messages: %w", err)
	}
	return messages, nil
}

// Ack records that the consumer processed every message up to and including
// offset. The next fetch starts at offset+1.
func (s *Store) Ack(ctx context.Context, consumer, topic string, offset int64) error {
	if offset < 0 {
		return fmt.Errorf("offset must be >= 0")
	}
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO consumer_offsets(consumer, topic, next_offset, updated_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(consumer, topic) DO UPDATE SET
		   next_offset = MAX(consumer_offsets.next_offset, excluded.next_offset),
		   updated_at = excluded.updated_at`,
		consumer,
		topic,
		offset+1,
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return fmt.Errorf("ack message: %w", err)
	}
	return nil
}
