#!/usr/bin/env python3
"""Generate the Triplanner Grafana dashboards.

The JSON files are embedded by the Helm chart through `.Files.Get`, so they are
plain assets rather than Go templates. Run from the repository root:

    python scripts/generate-dashboards.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "helm" / "helm-triplanner" / "dashboards"
DATASOURCE = {"type": "prometheus", "uid": "prometheus"}
SERVICE_RE = "api|users|trips|locations|agent|email|broker|web"

SERVICES = [
    {
        "key": "api",
        "title": "API",
        "service": "api",
        "job": "triplanner-api",
        "description": "GraphQL facade, internal agent routes and uploads.",
    },
    {
        "key": "users",
        "title": "Users",
        "service": "users",
        "job": "triplanner-users",
        "description": "Accounts, login, favorites and notifications.",
    },
    {
        "key": "trips",
        "title": "Trips",
        "service": "trips",
        "job": "triplanner-trips",
        "description": "Trips, members, itinerary items, invitations and reminders.",
    },
    {
        "key": "locations",
        "title": "Locations",
        "service": "locations",
        "job": "triplanner-locations",
        "description": "Toronto catalogue, search and HasData BYOK cache.",
    },
    {
        "key": "agent",
        "title": "Agent",
        "service": "agent",
        "job": "triplanner-agent",
        "description": "Suggestions, day plans and pgvector enrichment.",
    },
    {
        "key": "email",
        "title": "Email",
        "service": "email",
        "job": "triplanner-email",
        "description": "Broker consumer, templates and Resend/sink delivery.",
    },
    {
        "key": "broker",
        "title": "Broker",
        "service": "broker",
        "job": "triplanner-kafka",
        "description": "HTTP topic/offset/ack broker for TripInvitation and LocationChanged.",
    },
    {
        "key": "web",
        "title": "Web",
        "service": "web",
        "job": "triplanner-web",
        "description": "Next.js API proxies and runtime. Static page traffic is not instrumented.",
    },
]


class Layout:
    def __init__(self) -> None:
        self.next_id = 1
        self.y = 0

    def id(self) -> int:
        value = self.next_id
        self.next_id += 1
        return value


def target(
    expr: str,
    legend: str | None = None,
    *,
    instant: bool = False,
    fmt: str | None = None,
) -> dict[str, Any]:
    value: dict[str, Any] = {
        "datasource": DATASOURCE,
        "editorMode": "code",
        "expr": expr,
        "range": not instant,
        "refId": "A",
    }
    if instant:
        value["instant"] = True
    if legend:
        value["legendFormat"] = legend
    if fmt:
        value["format"] = fmt
    return value


def up_mappings() -> list[dict[str, Any]]:
    return [
        {
            "options": {
                "0": {"color": "red", "index": 0, "text": "DOWN"},
                "1": {"color": "green", "index": 1, "text": "UP"},
            },
            "type": "value",
        }
    ]


def up_thresholds() -> dict[str, Any]:
    return {
        "mode": "absolute",
        "steps": [
            {"color": "red", "value": None},
            {"color": "green", "value": 1},
        ],
    }


def error_thresholds() -> dict[str, Any]:
    return {
        "mode": "absolute",
        "steps": [
            {"color": "green", "value": None},
            {"color": "orange", "value": 0.01},
            {"color": "red", "value": 0.05},
        ],
    }


def default_thresholds() -> dict[str, Any]:
    return {"mode": "absolute", "steps": [{"color": "green", "value": None}]}


def timeseries_field(unit: str) -> dict[str, Any]:
    return {
        "defaults": {
            "color": {"mode": "palette-classic"},
            "custom": {
                "axisCenteredZero": False,
                "axisColorMode": "text",
                "axisLabel": "",
                "axisPlacement": "auto",
                "barAlignment": 0,
                "drawStyle": "line",
                "fillOpacity": 10,
                "gradientMode": "none",
                "hideFrom": {"legend": False, "tooltip": False, "viz": False},
                "lineInterpolation": "linear",
                "lineWidth": 1,
                "pointSize": 5,
                "scaleDistribution": {"type": "linear"},
                "showPoints": "never",
                "spanNulls": False,
                "stacking": {"group": "A", "mode": "none"},
                "thresholdsStyle": {"mode": "off"},
            },
            "mappings": [],
            "thresholds": default_thresholds(),
            "unit": unit,
        },
        "overrides": [],
    }


def stat_field(
    unit: str,
    mappings: list[dict[str, Any]] | None = None,
    thresholds: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "defaults": {
            "color": {"mode": "thresholds"},
            "mappings": mappings or [],
            "thresholds": thresholds or default_thresholds(),
            "unit": unit,
        },
        "overrides": [],
    }


def table_field(
    unit: str = "short",
    mappings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "defaults": {
            "custom": {
                "align": "auto",
                "cellOptions": {"type": "auto"},
                "inspect": False,
            },
            "mappings": mappings or [],
            "thresholds": default_thresholds(),
            "unit": unit,
        },
        "overrides": [],
    }


def row(panel_id: int, title: str, y: int) -> dict[str, Any]:
    return {
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": y},
        "id": panel_id,
        "panels": [],
        "title": title,
        "type": "row",
    }


def stat(
    panel_id: int,
    title: str,
    expr: str,
    unit: str,
    x: int,
    y: int,
    w: int = 4,
    h: int = 4,
    *,
    mappings: list[dict[str, Any]] | None = None,
    thresholds: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "datasource": DATASOURCE,
        "fieldConfig": stat_field(unit, mappings, thresholds),
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "id": panel_id,
        "options": {
            "colorMode": "value",
            "graphMode": "area",
            "justifyMode": "auto",
            "orientation": "auto",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "textMode": "auto",
        },
        "targets": [target(expr, instant=True)],
        "title": title,
        "type": "stat",
    }


def timeseries(
    panel_id: int,
    title: str,
    expr: str,
    legend: str,
    unit: str,
    x: int,
    y: int,
    w: int = 12,
    h: int = 8,
) -> dict[str, Any]:
    return {
        "datasource": DATASOURCE,
        "fieldConfig": timeseries_field(unit),
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "id": panel_id,
        "options": {
            "legend": {
                "calcs": [],
                "displayMode": "list",
                "placement": "bottom",
                "showLegend": True,
            },
            "tooltip": {"mode": "single", "sort": "none"},
        },
        "targets": [target(expr, legend)],
        "title": title,
        "type": "timeseries",
    }


def table(
    panel_id: int,
    title: str,
    expr: str,
    x: int,
    y: int,
    w: int = 12,
    h: int = 8,
    *,
    unit: str = "short",
    mappings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "datasource": DATASOURCE,
        "fieldConfig": table_field(unit, mappings),
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "id": panel_id,
        "options": {"showHeader": True},
        "targets": [target(expr, fmt="table", instant=True)],
        "title": title,
        "type": "table",
    }


def dashboard(
    uid: str,
    title: str,
    description: str,
    tags: list[str],
    panels: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "annotations": {"list": []},
        "description": description,
        "editable": True,
        "fiscalYearStartMonth": 0,
        "graphTooltip": 1,
        "id": None,
        "links": [],
        "panels": panels,
        "refresh": "30s",
        "schemaVersion": 39,
        "tags": ["triplanner", *tags],
        "templating": {"list": []},
        "time": {"from": "now-6h", "to": "now"},
        "timepicker": {},
        "timezone": "browser",
        "title": title,
        "uid": uid,
        "version": 1,
        "weekStart": "",
    }


def service_dashboard(svc: dict[str, str]) -> dict[str, Any]:
    layout = Layout()
    panels: list[dict[str, Any]] = []

    panels.append(row(layout.id(), "Overview", layout.y))
    layout.y += 1
    y = layout.y
    panels.append(
        stat(
            layout.id(),
            "Service up",
            f'up{{job="{svc["job"]}"}}',
            "short",
            0,
            y,
            4,
            4,
            mappings=up_mappings(),
            thresholds=up_thresholds(),
        )
    )
    panels.append(
        stat(
            layout.id(),
            "Requests / sec",
            f'sum(rate(triplanner_http_requests_total{{service="{svc["service"]}"}}[5m]))',
            "reqps",
            4,
            y,
            5,
            4,
        )
    )
    panels.append(
        stat(
            layout.id(),
            "5xx ratio",
            (
                f'sum(rate(triplanner_http_requests_total{{service="{svc["service"]}",status=~"5.."}}[5m]))'
                f' / clamp_min(sum(rate(triplanner_http_requests_total{{service="{svc["service"]}"}}[5m])), 0.001)'
            ),
            "percentunit",
            9,
            y,
            5,
            4,
            thresholds=error_thresholds(),
        )
    )
    panels.append(
        stat(
            layout.id(),
            "p95 latency",
            (
                "histogram_quantile(0.95, sum by (le) "
                f'(rate(triplanner_http_request_duration_seconds_bucket{{service="{svc["service"]}"}}[5m])))'
            ),
            "s",
            14,
            y,
            5,
            4,
        )
    )
    panels.append(
        stat(
            layout.id(),
            "In flight",
            f'sum(triplanner_http_requests_in_flight{{service="{svc["service"]}"}})',
            "short",
            19,
            y,
            5,
            4,
        )
    )
    layout.y += 4

    panels.append(row(layout.id(), "Traffic", layout.y))
    layout.y += 1
    y = layout.y
    panels.append(
        timeseries(
            layout.id(),
            "Requests by route",
            f'sum by (route) (rate(triplanner_http_requests_total{{service="{svc["service"]}"}}[5m]))',
            "{{route}}",
            "reqps",
            0,
            y,
        )
    )
    panels.append(
        timeseries(
            layout.id(),
            "p95 by route",
            (
                "histogram_quantile(0.95, sum by (le, route) "
                f'(rate(triplanner_http_request_duration_seconds_bucket{{service="{svc["service"]}"}}[5m])))'
            ),
            "{{route}}",
            "s",
            12,
            y,
        )
    )
    layout.y += 8

    panels.append(row(layout.id(), "Runtime", layout.y))
    layout.y += 1
    y = layout.y
    panels.append(
        timeseries(
            layout.id(),
            "CPU",
            f'rate(process_cpu_seconds_total{{job="{svc["job"]}"}}[5m])',
            "{{pod}}",
            "percentunit",
            0,
            y,
            8,
        )
    )
    panels.append(
        timeseries(
            layout.id(),
            "Memory",
            f'process_resident_memory_bytes{{job="{svc["job"]}"}}',
            "{{pod}}",
            "bytes",
            8,
            y,
            8,
        )
    )
    panels.append(
        timeseries(
            layout.id(),
            "In-flight trend",
            f'sum(triplanner_http_requests_in_flight{{service="{svc["service"]}"}})',
            "in flight",
            "short",
            16,
            y,
            8,
        )
    )
    layout.y += 8

    panels.append(row(layout.id(), "Routes and build", layout.y))
    layout.y += 1
    y = layout.y
    panels.append(
        table(
            layout.id(),
            "Top routes",
            f'topk(10, sum by (route) (rate(triplanner_http_requests_total{{service="{svc["service"]}"}}[5m])))',
            0,
            y,
            12,
            8,
            unit="reqps",
        )
    )
    panels.append(
        table(
            layout.id(),
            "Build info",
            f'triplanner_build_info{{service="{svc["service"]}"}}',
            12,
            y,
            12,
            8,
        )
    )

    return dashboard(
        f"triplanner-{svc['key']}",
        f"Triplanner / {svc['title']}",
        svc["description"],
        [svc["key"]],
        panels,
    )


def overview_dashboard() -> dict[str, Any]:
    layout = Layout()
    panels: list[dict[str, Any]] = []

    panels.append(row(layout.id(), "Health", layout.y))
    layout.y += 1
    y = layout.y
    panels.append(
        table(
            layout.id(),
            "Service health",
            'up{job=~"triplanner-.*"}',
            0,
            y,
            12,
            8,
            mappings=up_mappings(),
        )
    )
    panels.append(
        table(
            layout.id(),
            "Build info",
            f'triplanner_build_info{{service=~"{SERVICE_RE}"}}',
            12,
            y,
            12,
            8,
        )
    )
    layout.y += 8

    panels.append(row(layout.id(), "Traffic", layout.y))
    layout.y += 1
    y = layout.y
    panels.append(
        timeseries(
            layout.id(),
            "Requests by service",
            (
                f'sum by (service) (rate(triplanner_http_requests_total{{service=~"{SERVICE_RE}"}}[5m]))'
            ),
            "{{service}}",
            "reqps",
            0,
            y,
        )
    )
    panels.append(
        timeseries(
            layout.id(),
            "5xx ratio by service",
            (
                f'sum by (service) (rate(triplanner_http_requests_total{{service=~"{SERVICE_RE}",status=~"5.."}}[5m]))'
                f' / clamp_min(sum by (service) (rate(triplanner_http_requests_total{{service=~"{SERVICE_RE}"}}[5m])), 0.001)'
            ),
            "{{service}}",
            "percentunit",
            12,
            y,
        )
    )
    layout.y += 8

    panels.append(
        timeseries(
            layout.id(),
            "p95 latency by service",
            (
                "histogram_quantile(0.95, sum by (le, service) "
                f'(rate(triplanner_http_request_duration_seconds_bucket{{service=~"{SERVICE_RE}"}}[5m])))'
            ),
            "{{service}}",
            "s",
            0,
            layout.y,
            24,
        )
    )

    return dashboard(
        "triplanner-overview",
        "Triplanner / Overview",
        "One-page health, traffic and latency view for all Triplanner runtimes.",
        ["overview"],
        panels,
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    dashboards = {"overview": overview_dashboard()}
    dashboards.update({svc["key"]: service_dashboard(svc) for svc in SERVICES})
    for name, value in dashboards.items():
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
