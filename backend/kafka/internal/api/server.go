package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"triplanner/backend/kafka/internal/store"
)

const maxBodyBytes = 1 << 20 // 1 MiB

var namePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

type Server struct {
	store  *store.Store
	logger *slog.Logger
}

func New(st *store.Store, logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	server := &Server{store: st, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", server.health)
	mux.HandleFunc("GET /ready", server.ready)
	mux.HandleFunc("POST /v1/topics/{topic}/messages", server.publish)
	mux.HandleFunc("GET /v1/topics/{topic}/messages", server.fetch)
	mux.HandleFunc("POST /v1/topics/{topic}/ack", server.ack)
	return mux
}

type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var body errorBody
	body.Error.Code = code
	body.Error.Message = message
	writeJSON(w, status, body)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "NOT_READY", "database is not ready")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

type publishRequest struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
}

func (s *Server) publish(w http.ResponseWriter, r *http.Request) {
	topic := r.PathValue("topic")
	if !namePattern.MatchString(topic) {
		writeError(w, http.StatusBadRequest, "INVALID_TOPIC", "invalid topic")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	defer r.Body.Close()

	var request publishRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "body must be valid JSON")
		return
	}
	if len(request.Value) == 0 || !json.Valid(request.Value) {
		writeError(w, http.StatusBadRequest, "INVALID_VALUE", "value must be valid JSON")
		return
	}
	if len(request.Key) > 256 {
		writeError(w, http.StatusBadRequest, "INVALID_KEY", "key is too long")
		return
	}

	offset, err := s.store.Publish(r.Context(), topic, request.Key, request.Value)
	if err != nil {
		s.logger.Error("publish failed", "topic", topic, "error", err)
		writeError(w, http.StatusInternalServerError, "PUBLISH_FAILED", "could not store message")
		return
	}
	s.logger.Info("message published", "topic", topic, "offset", offset)
	writeJSON(w, http.StatusCreated, map[string]any{"offset": offset})
}

type fetchMessage struct {
	Offset int64           `json:"offset"`
	Key    string          `json:"key"`
	Value  json.RawMessage `json:"value"`
}

func (s *Server) fetch(w http.ResponseWriter, r *http.Request) {
	topic := r.PathValue("topic")
	if !namePattern.MatchString(topic) {
		writeError(w, http.StatusBadRequest, "INVALID_TOPIC", "invalid topic")
		return
	}
	consumer := r.URL.Query().Get("consumer")
	if !namePattern.MatchString(consumer) {
		writeError(w, http.StatusBadRequest, "INVALID_CONSUMER", "consumer is required and must be a valid name")
		return
	}
	limit, err := intQuery(r, "limit", 10, 1, 100)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_LIMIT", err.Error())
		return
	}
	waitSeconds, err := intQuery(r, "wait", 0, 0, 30)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_WAIT", err.Error())
		return
	}

	deadline := time.Now().Add(time.Duration(waitSeconds) * time.Second)
	for {
		messages, err := s.store.Fetch(r.Context(), consumer, topic, limit)
		if err != nil {
			s.logger.Error("fetch failed", "topic", topic, "consumer", consumer, "error", err)
			writeError(w, http.StatusInternalServerError, "FETCH_FAILED", "could not read messages")
			return
		}
		if len(messages) > 0 || waitSeconds == 0 || time.Now().After(deadline) {
			response := make([]fetchMessage, 0, len(messages))
			for _, message := range messages {
				response = append(response, fetchMessage{
					Offset: message.Offset,
					Key:    message.Key,
					Value:  json.RawMessage(message.Value),
				})
			}
			writeJSON(w, http.StatusOK, map[string]any{"messages": response})
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
}

type ackRequest struct {
	Consumer string `json:"consumer"`
	Offset   *int64 `json:"offset"`
}

func (s *Server) ack(w http.ResponseWriter, r *http.Request) {
	topic := r.PathValue("topic")
	if !namePattern.MatchString(topic) {
		writeError(w, http.StatusBadRequest, "INVALID_TOPIC", "invalid topic")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	defer r.Body.Close()

	var request ackRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "body must be valid JSON")
		return
	}
	if !namePattern.MatchString(request.Consumer) {
		writeError(w, http.StatusBadRequest, "INVALID_CONSUMER", "invalid consumer")
		return
	}
	if request.Offset == nil || *request.Offset < 0 {
		writeError(w, http.StatusBadRequest, "INVALID_OFFSET", "offset must be >= 0")
		return
	}
	if err := s.store.Ack(r.Context(), request.Consumer, topic, *request.Offset); err != nil {
		s.logger.Error("ack failed", "topic", topic, "consumer", request.Consumer, "error", err)
		writeError(w, http.StatusInternalServerError, "ACK_FAILED", "could not commit offset")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"acknowledged": true})
}

func intQuery(r *http.Request, name string, fallback, min, max int) (int, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < min || value > max {
		return 0, errors.New(name + " must be between " + strconv.Itoa(min) + " and " + strconv.Itoa(max))
	}
	return value, nil
}
