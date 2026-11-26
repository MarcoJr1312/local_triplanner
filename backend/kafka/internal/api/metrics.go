package api

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const serviceName = "broker"

type metrics struct {
	registry     *prometheus.Registry
	httpRequests *prometheus.CounterVec
	httpDuration *prometheus.HistogramVec
	inFlight     prometheus.Gauge
}

func newMetrics() *metrics {
	m := &metrics{
		registry: prometheus.NewRegistry(),
		httpRequests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "triplanner_http_requests_total",
			Help: "Completed HTTP requests.",
		}, []string{"service", "method", "route", "status"}),
		httpDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "triplanner_http_request_duration_seconds",
			Help:    "HTTP request duration in seconds.",
			Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60},
		}, []string{"service", "method", "route", "status"}),
		inFlight: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "triplanner_http_requests_in_flight",
			Help: "HTTP requests currently being served.",
		}),
	}

	version := os.Getenv("SERVICE_VERSION")
	if version == "" {
		version = "dev"
	}
	buildInfo := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "triplanner_build_info",
		Help: "Triplanner build information; always 1.",
	}, []string{"service", "version"})
	buildInfo.WithLabelValues(serviceName, version).Set(1)

	m.registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		m.httpRequests,
		m.httpDuration,
		m.inFlight,
		buildInfo,
	)
	return m
}

func (m *metrics) handler() http.Handler {
	prom := promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		prom.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(body)
}

// middleware records the route template exposed by Go 1.23's ServeMux. It
// never records raw paths, topics, consumers or IDs.
func (m *metrics) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}

		started := time.Now()
		m.inFlight.Inc()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			m.inFlight.Dec()
			route := r.Pattern
			if i := strings.IndexByte(route, ' '); i >= 0 {
				route = route[i+1:]
			}
			if route == "" {
				route = "other"
			}
			labels := []string{serviceName, r.Method, route, strconv.Itoa(sw.status)}
			m.httpRequests.WithLabelValues(labels...).Inc()
			m.httpDuration.WithLabelValues(labels...).Observe(time.Since(started).Seconds())
		}()
		next.ServeHTTP(sw, r)
	})
}
