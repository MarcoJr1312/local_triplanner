# Grafana PromQL skill (vendored)

Source: <https://github.com/grafana/skills/tree/main/skills/grafana-core/promql>

- Upstream commit: `8fb72a5` (vendored 2026-11-25)
- License: Apache-2.0 (`LICENSE`)
- Used by: the `sre-devops` agent and the Kubernetes Manifest Delivery workflow.

The skill covers `rate`/`increase` windows, aggregation order,
`histogram_quantile` with `le`, error-ratio guards, recording rules and
cardinality-safe query patterns.
