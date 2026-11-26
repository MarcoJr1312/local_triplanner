#!/usr/bin/env python3
"""Generate the Triplanner Grafana dashboards.

The JSON follows the vendored `grafana-dashboarding` and `grafana-promql`
skills: schemaVersion 41, a `${datasource}` variable, 24-column layout,
`$__rate_interval`, units, thresholds, descriptions, dashboard links,
transformations and a route-health bar gauge.

Run from the repository root:

    python scripts/generate-dashboards.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "helm" / "helm-triplanner" / "dashboards"
DATASOURCE_UID = "${datasource}"
DATASOURCE = {"type": "prometheus", "uid": DATASOURCE_UID}
RATE = "$__rate_interval"
SERVICE_RE = "api|users|trips|locations|agent|email|broker|web"
LEGEND_ROUTE = "{{route}}"
LEGEND_STATUS = "{{status}}"
LEGEND_POD = "{{pod}}"
LEGEND_SERVICE = "{{service}}"

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
        "grpc": True,
    },
    {
        "key": "trips",
        "title": "Trips",
        "service": "trips",
        "job": "triplanner-trips",
        "description": "Trips, members, itinerary items, invitations and reminders.",
        "grpc": True,
    },
    {
        "key": "locations",
        "title": "Locations",
        "service": "locations",
        "job": "triplanner-locations",
        "description": "Toronto catalogue, search and HasData BYOK cache.",
        "grpc": True,
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
        "description": "HTTP topic/offset/ack broker. Fetch is a long-poll (up to 20 s), so latency p50/p95 includes deliberate wait time.",
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


def datasource_variable() -> dict[str, Any]:
    return {
        "name": "datasource",
        "label": "Data source",
        "type": "datasource",
        "query": "prometheus",
        "current": {"selected": False, "text": "Prometheus", "value": "prometheus"},
        "hide": 0,
        "includeAll": False,
        "multi": False,
        "refresh": 1,
        "regex": "",
        "skipUrlSync": False,
    }


def query_variable(name: str, label: str, query: str) -> dict[str, Any]:
    return {
        "name": name,
        "label": label,
        "type": "query",
        "datasource": DATASOURCE,
        "query": {"query": query, "refId": "A"},
        "refresh": 2,
        "includeAll": True,
        "multi": True,
        "allValue": ".*",
        "current": {"selected": True, "text": ["All"], "value": ["$__all"]},
        "sort": 1,
        "hide": 0,
        "regex": "",
        "skipUrlSync": False,
    }


def dashboard_link(title: str, url: str) -> dict[str, Any]:
    return {
        "title": title,
        "url": url,
        "type": "link",
        "icon": "dashboard",
        "targetBlank": False,
        "keepTime": True,
        "includeVars": False,
    }


OVERVIEW_LINKS = [
    dashboard_link(f"Triplanner / {svc['title']}", f"/d/triplanner-{svc['key']}")
    for svc in SERVICES
] + [
    dashboard_link("Triplanner / PostgreSQL", "/d/triplanner-postgres"),
    dashboard_link("Triplanner / MongoDB", "/d/triplanner-mongodb"),
]
SERVICE_LINKS = [dashboard_link("Triplanner overview", "/d/triplanner-overview")]
POSTGRES_LINKS = SERVICE_LINKS + [
    dashboard_link("Triplanner / MongoDB", "/d/triplanner-mongodb")
]
MONGO_LINKS = SERVICE_LINKS + [
    dashboard_link("Triplanner / PostgreSQL", "/d/triplanner-postgres")
]


def default_thresholds() -> dict[str, Any]:
    return {"mode": "absolute", "steps": [{"color": "green", "value": None}]}


def error_thresholds() -> dict[str, Any]:
    return {
        "mode": "absolute",
        "steps": [
            {"color": "green", "value": None},
            {"color": "orange", "value": 0.01},
            {"color": "red", "value": 0.05},
        ],
    }


def latency_thresholds() -> dict[str, Any]:
    return {
        "mode": "absolute",
        "steps": [
            {"color": "green", "value": None},
            {"color": "orange", "value": 0.5},
            {"color": "red", "value": 1.0},
        ],
    }


def usage_thresholds() -> dict[str, Any]:
    return {
        "mode": "absolute",
        "steps": [
            {"color": "green", "value": None},
            {"color": "orange", "value": 0.8},
            {"color": "red", "value": 0.95},
        ],
    }


def cache_hit_thresholds() -> dict[str, Any]:
    return {
        "mode": "absolute",
        "steps": [
            {"color": "red", "value": None},
            {"color": "orange", "value": 0.8},
            {"color": "green", "value": 0.95},
        ],
    }


def deadlock_thresholds() -> dict[str, Any]:
    return {
        "mode": "absolute",
        "steps": [
            {"color": "green", "value": None},
            {"color": "orange", "value": 0.01},
            {"color": "red", "value": 0.1},
        ],
    }


def transaction_thresholds() -> dict[str, Any]:
    return {
        "mode": "absolute",
        "steps": [
            {"color": "green", "value": None},
            {"color": "orange", "value": 300},
            {"color": "red", "value": 900},
        ],
    }


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


def target(
    expr: str,
    legend: str | None = None,
    *,
    instant: bool = False,
    fmt: str | None = None,
    ref_id: str = "A",
) -> dict[str, Any]:
    value: dict[str, Any] = {
        "editorMode": "code",
        "expr": expr,
        "range": not instant,
        "refId": ref_id,
    }
    if instant:
        value["instant"] = True
    if legend:
        value["legendFormat"] = legend
    if fmt:
        value["format"] = fmt
    return value


def timeseries_field(
    unit: str,
    *,
    thresholds: dict[str, Any] | None = None,
    color_mode: str = "palette-classic",
    thresholds_style: str = "off",
    min_value: float | None = None,
    max_value: float | None = None,
) -> dict[str, Any]:
    defaults: dict[str, Any] = {
        "color": {"mode": color_mode},
        "custom": {
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "drawStyle": "line",
            "fillOpacity": 8,
            "gradientMode": "none",
            "hideFrom": {"legend": False, "tooltip": False, "viz": False},
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {"type": "linear"},
            "showPoints": "never",
            "spanNulls": False,
            "stacking": {"group": "A", "mode": "none"},
            "thresholdsStyle": {"mode": thresholds_style},
        },
        "mappings": [],
        "thresholds": thresholds or default_thresholds(),
        "unit": unit,
        "noValue": "No data",
    }
    if min_value is not None:
        defaults["min"] = min_value
    if max_value is not None:
        defaults["max"] = max_value
    return {"defaults": defaults, "overrides": []}


def stat_field(
    unit: str,
    *,
    mappings: list[dict[str, Any]] | None = None,
    thresholds: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "defaults": {
            "color": {"mode": "thresholds"},
            "mappings": mappings or [],
            "thresholds": thresholds or default_thresholds(),
            "unit": unit,
            "noValue": "No data",
        },
        "overrides": [],
    }


def table_field(
    unit: str,
    *,
    mappings: list[dict[str, Any]] | None = None,
    thresholds: dict[str, Any] | None = None,
    cell_type: str = "auto",
) -> dict[str, Any]:
    return {
        "defaults": {
            "custom": {
                "align": "auto",
                "cellOptions": {"type": cell_type},
                "inspect": False,
            },
            "mappings": mappings or [],
            "thresholds": thresholds or default_thresholds(),
            "unit": unit,
            "noValue": "No data",
        },
        "overrides": [],
    }


def bargauge_field(
    unit: str,
    *,
    thresholds: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "defaults": {
            "color": {"mode": "thresholds"},
            "mappings": [],
            "min": 0,
            "max": 1,
            "thresholds": thresholds or default_thresholds(),
            "unit": unit,
            "noValue": "No data",
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
    description: str = "",
    mappings: list[dict[str, Any]] | None = None,
    thresholds: dict[str, Any] | None = None,
    graph_mode: str = "area",
    legend: str | None = None,
    extra: list[tuple[str, str]] | None = None,
) -> dict[str, Any]:
    targets = [target(expr, legend, instant=True)]
    for index, (extra_expr, extra_legend) in enumerate(extra or []):
        targets.append(
            target(extra_expr, extra_legend, instant=True, ref_id=chr(66 + index))
        )
    return {
        "datasource": DATASOURCE,
        "description": description,
        "fieldConfig": stat_field(unit, mappings=mappings, thresholds=thresholds),
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "id": panel_id,
        "options": {
            "colorMode": "value",
            "graphMode": graph_mode,
            "justifyMode": "auto",
            "orientation": "auto",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "textMode": "auto",
        },
        "targets": targets,
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
    *,
    description: str = "",
    legend_mode: str = "table",
    tooltip: str = "multi",
    thresholds: dict[str, Any] | None = None,
    color_mode: str = "palette-classic",
    thresholds_style: str = "off",
    min_value: float | None = None,
    max_value: float | None = None,
    extra: list[tuple[str, str]] | None = None,
) -> dict[str, Any]:
    targets = [target(expr, legend)]
    for index, (extra_expr, extra_legend) in enumerate(extra or []):
        targets.append(target(extra_expr, extra_legend, ref_id=chr(66 + index)))
    return {
        "datasource": DATASOURCE,
        "description": description,
        "fieldConfig": timeseries_field(
            unit,
            thresholds=thresholds,
            color_mode=color_mode,
            thresholds_style=thresholds_style,
            min_value=min_value,
            max_value=max_value,
        ),
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "id": panel_id,
        "options": {
            "legend": {
                "calcs": ["mean", "max", "lastNotNull"],
                "displayMode": legend_mode,
                "placement": "bottom",
                "showLegend": True,
            },
            "tooltip": {"mode": tooltip, "sort": "desc"},
        },
        "targets": targets,
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
    description: str = "",
    unit: str = "short",
    mappings: list[dict[str, Any]] | None = None,
    thresholds: dict[str, Any] | None = None,
    cell_type: str = "auto",
    transformations: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "datasource": DATASOURCE,
        "description": description,
        "fieldConfig": table_field(
            unit,
            mappings=mappings,
            thresholds=thresholds,
            cell_type=cell_type,
        ),
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "id": panel_id,
        "options": {"showHeader": True, "cellHeight": "sm"},
        "targets": [target(expr, fmt="table", instant=True)],
        "title": title,
        "transformations": transformations or [],
        "type": "table",
    }


def bargauge(
    panel_id: int,
    title: str,
    expr: str,
    x: int,
    y: int,
    w: int = 8,
    h: int = 8,
    *,
    description: str = "",
    unit: str = "percentunit",
    thresholds: dict[str, Any] | None = None,
    legend: str | None = None,
) -> dict[str, Any]:
    return {
        "datasource": DATASOURCE,
        "description": description,
        "fieldConfig": bargauge_field(unit, thresholds=thresholds),
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "id": panel_id,
        "options": {
            "displayMode": "gradient",
            "namePlacement": "auto",
            "orientation": "horizontal",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "showUnfilled": True,
            "sizing": "auto",
            "valueMode": "color",
        },
        "targets": [target(expr, legend, instant=True)],
        "title": title,
        "type": "bargauge",
    }


def dashboard(
    uid: str,
    title: str,
    description: str,
    tags: list[str],
    panels: list[dict[str, Any]],
    templating: list[dict[str, Any]],
    links: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "annotations": {"list": []},
        "description": description,
        "editable": True,
        "fiscalYearStartMonth": 0,
        "graphTooltip": 1,
        "id": None,
        "links": links,
        "panels": panels,
        "refresh": "30s",
        "schemaVersion": 41,
        "tags": ["triplanner", *tags],
        "templating": {"list": templating},
        "time": {"from": "now-6h", "to": "now"},
        "timepicker": {
            "refresh_intervals": ["5s", "10s", "30s", "1m", "5m", "15m", "30m", "1h", "6h", "12h", "1d"],
        },
        "timezone": "browser",
        "title": title,
        "uid": uid,
        "version": 1,
        "weekStart": "",
    }


def rate_expr(metric: str, selector: str, by: str = "") -> str:
    agg = f" by ({by})" if by else ""
    return "sum" + agg + "(rate(" + metric + "{" + selector + "}[" + RATE + "]))"


def quantile_expr(
    metric: str,
    selector: str,
    quantile: float,
    by: str = "",
) -> str:
    agg = f" by ({by})" if by else ""
    return (
        f"histogram_quantile({quantile}, sum{agg}(rate("
        f"{metric}_bucket{{{selector}}}[{RATE}])))"
    )


def latency_expr(service: str, quantile: float, by_route: bool = False) -> str:
    selector = f'service="{service}",route=~"$route"'
    by = "le, route" if by_route else "le"
    return quantile_expr(
        "triplanner_http_request_duration_seconds", selector, quantile, by
    )


def error_ratio_expr(selector: str, by: str = "") -> str:
    """5xx ratio with a zero fallback so healthy services render 0, not No data."""
    errors = rate_expr("triplanner_http_requests_total", selector + ',status=~"5.."', by)
    total = rate_expr("triplanner_http_requests_total", selector, by)
    ratio = errors + " / clamp_min(" + total + ", 0.001)"
    if by:
        return "(" + ratio + ") or (0 * " + total + ")"
    return "(" + ratio + ") or vector(0)"


def grpc_latency_expr(service: str, quantile: float, by_method: bool = False) -> str:
    by = "le, method" if by_method else "le"
    return quantile_expr(
        "triplanner_grpc_request_duration_seconds",
        f'service="{service}"',
        quantile,
        by,
    )


def grpc_error_ratio_expr(service: str) -> str:
    """Non-OK gRPC ratio with a zero fallback for healthy services."""
    errors = rate_expr(
        "triplanner_grpc_requests_total", f'service="{service}",status!="OK"'
    )
    total = rate_expr("triplanner_grpc_requests_total", f'service="{service}"')
    return "(" + errors + " / clamp_min(" + total + ", 0.001)) or vector(0)"


def service_dashboard(svc: dict[str, str]) -> dict[str, Any]:
    layout = Layout()
    panels: list[dict[str, Any]] = []
    service = svc["service"]
    job = svc["job"]
    service_route = f'service="{service}",route=~"$route"'
    latency_note = (
        " p50/p95 include deliberate long-poll wait on /v1/topics/{topic}/messages."
        if svc["key"] == "broker"
        else ""
    )

    def add(panel: dict[str, Any]) -> None:
        panels.append(panel)

    add(row(layout.id(), "Overview", layout.y))
    layout.y += 1
    y = layout.y
    add(
        stat(
            layout.id(),
            "Up",
            f'up{{job="{job}"}}',
            "short",
            0,
            y,
            4,
            4,
            description="Scrape target health: 1 = up, 0 = down.",
            mappings=up_mappings(),
            thresholds=up_thresholds(),
            graph_mode="none",
        )
    )
    add(
        stat(
            layout.id(),
            "Requests / sec",
            rate_expr("triplanner_http_requests_total", service_route),
            "reqps",
            4,
            y,
            5,
            4,
            description="Requests per second across the selected routes.",
        )
    )
    add(
        stat(
            layout.id(),
            "5xx ratio",
            error_ratio_expr(service_route),
            "percentunit",
            9,
            y,
            4,
            4,
            description="Share of requests returning 5xx; orange above 1%, red above 5%.",
            thresholds=error_thresholds(),
        )
    )
    add(
        stat(
            layout.id(),
            "Latency p50 / p95",
            latency_expr(service, 0.50),
            "s",
            13,
            y,
            7,
            4,
            description="p50 baseline and p95 tail request duration; p95 turns orange above 500 ms and red above 1 s."
            + latency_note,
            thresholds=latency_thresholds(),
            legend="p50",
            extra=[(latency_expr(service, 0.95), "p95")],
        )
    )
    add(
        stat(
            layout.id(),
            "In flight",
            f'sum(triplanner_http_requests_in_flight{{service="{service}"}})',
            "short",
            20,
            y,
            4,
            4,
            description="Requests currently being served.",
            graph_mode="none",
        )
    )
    layout.y += 4

    add(row(layout.id(), "Traffic", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Requests by route",
            rate_expr("triplanner_http_requests_total", service_route, "route"),
            LEGEND_ROUTE,
            "reqps",
            0,
            y,
            description="Request rate per route template.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    add(
        timeseries(
            layout.id(),
            "Latency by route (p50 / p95)",
            latency_expr(service, 0.50, by_route=True),
            "p50 {{route}}",
            "s",
            12,
            y,
            description="p50 baseline and p95 tail latency per route template."
            + latency_note,
            legend_mode="table",
            tooltip="multi",
            extra=[(latency_expr(service, 0.95, by_route=True), "p95 {{route}}")],
        )
    )
    layout.y += 8

    if svc.get("grpc"):
        add(row(layout.id(), "gRPC", layout.y))
        layout.y += 1
        y = layout.y
        add(
            stat(
                layout.id(),
                "gRPC req/s",
                rate_expr("triplanner_grpc_requests_total", f'service="{service}"'),
                "reqps",
                0,
                y,
                8,
                4,
                description="gRPC calls per second from the API facade.",
            )
        )
        add(
            stat(
                layout.id(),
                "gRPC p50 / p95",
                grpc_latency_expr(service, 0.50),
                "s",
                8,
                y,
                8,
                4,
                description="p50 baseline and p95 tail gRPC call duration.",
                thresholds=latency_thresholds(),
                legend="p50",
                extra=[(grpc_latency_expr(service, 0.95), "p95")],
            )
        )
        add(
            stat(
                layout.id(),
                "gRPC error ratio",
                grpc_error_ratio_expr(service),
                "percentunit",
                16,
                y,
                8,
                4,
                description="Share of gRPC calls not returning OK; orange above 1%, red above 5%.",
                thresholds=error_thresholds(),
            )
        )
        layout.y += 4
        y = layout.y
        add(
            timeseries(
                layout.id(),
                "gRPC calls by method",
                rate_expr(
                    "triplanner_grpc_requests_total", f'service="{service}"', "method"
                ),
                "{{method}}",
                "reqps",
                0,
                y,
                description="gRPC call rate per proto method.",
                legend_mode="table",
                tooltip="multi",
            )
        )
        add(
            timeseries(
                layout.id(),
                "gRPC calls by status",
                rate_expr(
                    "triplanner_grpc_requests_total", f'service="{service}"', "status"
                ),
                LEGEND_STATUS,
                "reqps",
                12,
                y,
                description="gRPC call rate by status code name.",
                legend_mode="table",
                tooltip="multi",
            )
        )
        layout.y += 8

    add(row(layout.id(), "Health", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Requests by status",
            rate_expr("triplanner_http_requests_total", service_route, "status"),
            LEGEND_STATUS,
            "reqps",
            0,
            y,
            8,
            description="Request rate by HTTP status code.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    add(
        bargauge(
            layout.id(),
            "5xx ratio by route",
            error_ratio_expr(service_route, "route"),
            8,
            y,
            8,
            description="5xx share per route; orange above 1%, red above 5%.",
            thresholds=error_thresholds(),
            legend=LEGEND_ROUTE,
        )
    )
    add(
        timeseries(
            layout.id(),
            "In-flight trend",
            f'sum(triplanner_http_requests_in_flight{{service="{service}"}})',
            "in flight",
            "short",
            16,
            y,
            8,
            description="Requests currently being served over time.",
            legend_mode="list",
            tooltip="single",
        )
    )
    layout.y += 8

    add(row(layout.id(), "Runtime", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "CPU",
            "rate(process_cpu_seconds_total{job=\"" + job + "\"}[" + RATE + "])",
            LEGEND_POD,
            "percentunit",
            0,
            y,
            12,
            description="Process CPU cores used.",
            legend_mode="list",
            tooltip="single",
        )
    )
    add(
        timeseries(
            layout.id(),
            "Memory",
            'process_resident_memory_bytes{job="' + job + '"}',
            LEGEND_POD,
            "bytes",
            12,
            y,
            12,
            description="Resident memory of the service process.",
            legend_mode="list",
            tooltip="single",
        )
    )
    layout.y += 8

    add(row(layout.id(), "Routes and build", layout.y))
    layout.y += 1
    y = layout.y
    add(
        table(
            layout.id(),
            "Top routes",
            "topk(10, " + rate_expr("triplanner_http_requests_total", service_route, "route") + ")",
            0,
            y,
            12,
            8,
            description="Top 10 routes by request rate.",
            unit="reqps",
            transformations=[
                {
                    "id": "organize",
                    "options": {
                        "excludeByName": {"Time": True},
                        "renameByName": {"Value": "Requests/s"},
                    },
                }
            ],
        )
    )
    add(
        table(
            layout.id(),
            "Build info",
            f'triplanner_build_info{{service="{service}"}}',
            12,
            y,
            12,
            8,
            description="Service build metadata currently scraped.",
            transformations=[
                {
                    "id": "organize",
                    "options": {
                        "excludeByName": {
                            "Time": True,
                            "__name__": True,
                            "job": True,
                            "instance": True,
                            "namespace": True,
                            "container": True,
                            "endpoint": True,
                            "pod": True,
                        },
                        "renameByName": {
                            "service": "Service",
                            "version": "Version",
                            "Value": "Present",
                        },
                    },
                }
            ],
        )
    )

    return dashboard(
        f"triplanner-{svc['key']}",
        f"Triplanner / {svc['title']}",
        svc["description"],
        [svc["key"]],
        panels,
        [
            datasource_variable(),
            query_variable(
                "route",
                "Route",
                f'label_values(triplanner_http_requests_total{{service="{service}"}}, route)',
            ),
        ],
        SERVICE_LINKS,
    )


def postgres_dashboard() -> dict[str, Any]:
    layout = Layout()
    panels: list[dict[str, Any]] = []
    service_sel = 'service=~"$service"'
    db_sel = 'service=~"$service",datname=~"$datname",datname!~"template.*|postgres"'

    def add(panel: dict[str, Any]) -> None:
        panels.append(panel)

    add(row(layout.id(), "Overview", layout.y))
    layout.y += 1
    y = layout.y
    add(
        stat(
            layout.id(),
            "Up",
            f'min(pg_up{{{service_sel}}})',
            "short",
            0,
            y,
            8,
            4,
            description="1 when every selected PostgreSQL exporter reports pg_up=1.",
            mappings=up_mappings(),
            thresholds=up_thresholds(),
            graph_mode="none",
        )
    )
    add(
        stat(
            layout.id(),
            "Connections",
            f'sum(pg_stat_database_numbackends{{{service_sel}}})',
            "short",
            8,
            y,
            8,
            4,
            description="Client backends across the selected PostgreSQL instances.",
        )
    )
    add(
        stat(
            layout.id(),
            "Max connections",
            f'max(pg_settings_max_connections{{{service_sel}}})',
            "short",
            16,
            y,
            8,
            4,
            description="max_connections on the selected instances.",
        )
    )
    layout.y += 4
    y = layout.y
    add(
        stat(
            layout.id(),
            "Database size",
            f'sum(pg_database_size_bytes{{{db_sel}}})',
            "bytes",
            0,
            y,
            8,
            4,
            description="Total size of the selected application databases.",
        )
    )
    add(
        stat(
            layout.id(),
            "Cache hit ratio",
            f'sum(pg_stat_database_blks_hit{{{db_sel}}}) / clamp_min(sum(pg_stat_database_blks_hit{{{db_sel}}}) + sum(pg_stat_database_blks_read{{{db_sel}}}), 1)',
            "percentunit",
            8,
            y,
            8,
            4,
            description="Lifetime buffer cache hit ratio; red below 80%, green above 95%.",
            thresholds=cache_hit_thresholds(),
        )
    )
    add(
        stat(
            layout.id(),
            "Deadlocks / sec",
            f'sum(rate(pg_stat_database_deadlocks{{{db_sel}}}[{RATE}]))',
            "ops",
            16,
            y,
            8,
            4,
            description="Deadlocks per second across the selected databases.",
            thresholds=deadlock_thresholds(),
        )
    )
    layout.y += 4

    add(row(layout.id(), "Connections", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Connections by database",
            f'sum by (datname) (pg_stat_database_numbackends{{{db_sel}}})',
            "{{datname}}",
            "short",
            0,
            y,
            description="Client backends per application database.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    add(
        timeseries(
            layout.id(),
            "Sessions by state",
            f'sum by (state) (pg_stat_activity_count{{{db_sel}}})',
            "{{state}}",
            "short",
            12,
            y,
            description="pg_stat_activity sessions grouped by state.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    layout.y += 8
    y = layout.y
    add(
        bargauge(
            layout.id(),
            "Connection usage by instance",
            f'sum by (service) (pg_stat_database_numbackends{{{service_sel}}}) / max by (service) (pg_settings_max_connections{{{service_sel}}})',
            0,
            y,
            12,
            6,
            description="Active connections divided by max_connections; orange above 80%, red above 95%.",
            thresholds=usage_thresholds(),
            legend=LEGEND_SERVICE,
        )
    )
    add(
        table(
            layout.id(),
            "Instances",
            f'pg_up{{{service_sel}}}',
            12,
            y,
            12,
            6,
            description="Scrape health for every PostgreSQL exporter.",
            mappings=up_mappings(),
            thresholds=up_thresholds(),
            transformations=[
                {
                    "id": "organize",
                    "options": {
                        "excludeByName": {
                            "Time": True,
                            "__name__": True,
                            "job": True,
                            "instance": True,
                            "namespace": True,
                            "container": True,
                            "endpoint": True,
                            "pod": True,
                        },
                        "renameByName": {"service": "Instance", "Value": "Up"},
                    },
                }
            ],
        )
    )
    layout.y += 6

    add(row(layout.id(), "Transactions", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Transactions by instance",
            f'sum by (service) (rate(pg_stat_database_xact_commit{{{db_sel}}}[{RATE}]))',
            "commit {{service}}",
            "ops",
            0,
            y,
            description="Committed and rolled-back transactions per second.",
            legend_mode="table",
            tooltip="multi",
            extra=[
                (
                    f'sum by (service) (rate(pg_stat_database_xact_rollback{{{db_sel}}}[{RATE}]))',
                    "rollback {{service}}",
                )
            ],
        )
    )
    add(
        timeseries(
            layout.id(),
            "Rollback ratio by instance",
            f'sum by (service) (rate(pg_stat_database_xact_rollback{{{db_sel}}}[{RATE}])) / clamp_min(sum by (service) (rate(pg_stat_database_xact_commit{{{db_sel}}}[{RATE}])) + sum by (service) (rate(pg_stat_database_xact_rollback{{{db_sel}}}[{RATE}])), 0.001)',
            LEGEND_SERVICE,
            "percentunit",
            12,
            y,
            description="Rollbacks as a share of all transactions; orange above 1%, red above 5%.",
            thresholds=error_thresholds(),
            min_value=0,
            max_value=1,
            legend_mode="table",
            tooltip="multi",
        )
    )
    layout.y += 8
    y = layout.y
    add(
        table(
            layout.id(),
            "Top databases by commits",
            f'topk(10, sum by (service, datname) (rate(pg_stat_database_xact_commit{{{db_sel}}}[{RATE}])))',
            0,
            y,
            12,
            8,
            description="Top 10 databases by committed transactions per second.",
            unit="ops",
            transformations=[
                {
                    "id": "organize",
                    "options": {
                        "excludeByName": {
                            "Time": True,
                            "__name__": True,
                            "job": True,
                            "instance": True,
                            "namespace": True,
                            "container": True,
                            "endpoint": True,
                            "pod": True,
                        },
                        "renameByName": {
                            "service": "Instance",
                            "datname": "Database",
                            "Value": "Commits/s",
                        },
                    },
                }
            ],
        )
    )
    add(
        timeseries(
            layout.id(),
            "Rollback rate by database",
            f'sum by (service, datname) (rate(pg_stat_database_xact_rollback{{{db_sel}}}[{RATE}]))',
            "{{service}} / {{datname}}",
            "ops",
            12,
            y,
            12,
            8,
            description="Rolled-back transactions per second per database.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    layout.y += 8

    add(row(layout.id(), "Cache and I/O", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Cache hit ratio by instance",
            f'sum by (service) (pg_stat_database_blks_hit{{{db_sel}}}) / clamp_min(sum by (service) (pg_stat_database_blks_hit{{{db_sel}}}) + sum by (service) (pg_stat_database_blks_read{{{db_sel}}}), 1)',
            LEGEND_SERVICE,
            "percentunit",
            0,
            y,
            description="Lifetime buffer cache hit ratio per instance.",
            thresholds=cache_hit_thresholds(),
            color_mode="thresholds",
            thresholds_style="line",
            min_value=0,
            max_value=1,
            legend_mode="table",
            tooltip="multi",
        )
    )
    add(
        timeseries(
            layout.id(),
            "Blocks read / sec",
            f'sum by (service) (rate(pg_stat_database_blks_read{{{db_sel}}}[{RATE}]))',
            LEGEND_SERVICE,
            "ops",
            12,
            y,
            description="Disk blocks read per second; a falling cache hit ratio usually raises this.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    layout.y += 8
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Temp bytes / sec",
            f'sum by (service) (rate(pg_stat_database_temp_bytes{{{db_sel}}}[{RATE}]))',
            LEGEND_SERVICE,
            "Bps",
            0,
            y,
            description="Temporary bytes written per second; spikes indicate spills.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    add(
        timeseries(
            layout.id(),
            "WAL size",
            f'pg_wal_size_bytes{{{service_sel}}}',
            LEGEND_SERVICE,
            "bytes",
            12,
            y,
            description="Current WAL size per PostgreSQL instance.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    layout.y += 8

    add(row(layout.id(), "Locks", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Locks by mode",
            f'sum by (mode) (pg_locks_count{{{db_sel}}})',
            "{{mode}}",
            "short",
            0,
            y,
            8,
            8,
            description="PostgreSQL lock count grouped by lock mode.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    add(
        timeseries(
            layout.id(),
            "Deadlocks / sec by instance",
            f'sum by (service) (rate(pg_stat_database_deadlocks{{{db_sel}}}[{RATE}]))',
            LEGEND_SERVICE,
            "ops",
            8,
            y,
            8,
            8,
            description="Deadlocks per second per PostgreSQL instance.",
            thresholds=deadlock_thresholds(),
            thresholds_style="line",
            legend_mode="table",
            tooltip="multi",
        )
    )
    add(
        stat(
            layout.id(),
            "Longest transaction",
            f'max(pg_stat_activity_max_tx_duration{{{db_sel}}})',
            "s",
            16,
            y,
            8,
            8,
            description="Longest open transaction in seconds; orange above 5 minutes, red above 15 minutes.",
            thresholds=transaction_thresholds(),
        )
    )
    layout.y += 8

    add(row(layout.id(), "Databases", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Database size by instance",
            f'pg_database_size_bytes{{{db_sel}}}',
            "{{service}} / {{datname}}",
            "bytes",
            0,
            y,
            description="Application database size over time.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    add(
        table(
            layout.id(),
            "Top databases by size",
            f'topk(10, pg_database_size_bytes{{{db_sel}}})',
            12,
            y,
            12,
            8,
            description="Top 10 application databases by current size.",
            unit="bytes",
            transformations=[
                {
                    "id": "organize",
                    "options": {
                        "excludeByName": {
                            "Time": True,
                            "__name__": True,
                            "job": True,
                            "instance": True,
                            "namespace": True,
                            "container": True,
                            "endpoint": True,
                            "pod": True,
                        },
                        "renameByName": {
                            "service": "Instance",
                            "datname": "Database",
                            "Value": "Size",
                        },
                    },
                }
            ],
        )
    )
    layout.y += 8

    add(row(layout.id(), "Exporter", layout.y))
    layout.y += 1
    y = layout.y
    add(
        stat(
            layout.id(),
            "Scrape error",
            f'sum(pg_exporter_last_scrape_error{{{service_sel}}})',
            "short",
            0,
            y,
            8,
            4,
            description="0 means the last scrape succeeded on every selected instance.",
            thresholds=deadlock_thresholds(),
            graph_mode="none",
        )
    )
    add(
        stat(
            layout.id(),
            "Last scrape",
            f'max(pg_exporter_last_scrape_duration_seconds{{{service_sel}}})',
            "s",
            8,
            y,
            8,
            4,
            description="Duration of the slowest last scrape; orange above 500 ms, red above 1 s.",
            thresholds=latency_thresholds(),
        )
    )
    add(
        stat(
            layout.id(),
            "Scrapes",
            f'sum(pg_exporter_scrapes_total{{{service_sel}}})',
            "short",
            16,
            y,
            8,
            4,
            description="Cumulative exporter scrapes since pod start.",
            graph_mode="none",
        )
    )
    layout.y += 4
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Exporter CPU",
            f'rate(process_cpu_seconds_total{{job=~"triplanner-postgres-.*"}}[{RATE}])',
            "{{job}}",
            "percentunit",
            0,
            y,
            description="CPU cores used by the PostgreSQL exporters.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    add(
        timeseries(
            layout.id(),
            "Exporter memory",
            'process_resident_memory_bytes{job=~"triplanner-postgres-.*"}',
            "{{job}}",
            "bytes",
            12,
            y,
            description="Resident memory of the PostgreSQL exporters.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    layout.y += 8

    return dashboard(
        "triplanner-postgres",
        "Triplanner / PostgreSQL",
        "Connections, transactions, cache, locks and size for the four Triplanner PostgreSQL instances.",
        ["postgres", "database"],
        panels,
        [
            datasource_variable(),
            query_variable("service", "Instance", "label_values(pg_up, service)"),
            query_variable(
                "datname",
                "Database",
                'label_values(pg_stat_database_numbackends{service=~"$service"}, datname)',
            ),
        ],
        POSTGRES_LINKS,
    )


def mongodb_dashboard() -> dict[str, Any]:
    layout = Layout()
    panels: list[dict[str, Any]] = []
    service_sel = 'service=~"$service"'

    def add(panel: dict[str, Any]) -> None:
        panels.append(panel)

    add(row(layout.id(), "Overview", layout.y))
    layout.y += 1
    y = layout.y
    add(
        stat(
            layout.id(),
            "Up",
            f'min(mongodb_up{{{service_sel}}})',
            "short",
            0,
            y,
            8,
            4,
            description="1 when the selected MongoDB exporter reports mongodb_up=1.",
            mappings=up_mappings(),
            thresholds=up_thresholds(),
            graph_mode="none",
        )
    )
    add(
        stat(
            layout.id(),
            "Uptime",
            f'min(mongodb_ss_uptime{{{service_sel}}})',
            "s",
            8,
            y,
            8,
            4,
            description="MongoDB server uptime in seconds.",
        )
    )
    add(
        stat(
            layout.id(),
            "Connections",
            f'sum(mongodb_ss_connections{{{service_sel},conn_type="current"}})',
            "short",
            16,
            y,
            8,
            4,
            description="Current MongoDB connections.",
        )
    )
    layout.y += 4
    y = layout.y
    add(
        stat(
            layout.id(),
            "Available connections",
            f'sum(mongodb_ss_connections{{{service_sel},conn_type="available"}})',
            "short",
            0,
            y,
            8,
            4,
            description="Connections still available before the server limit.",
        )
    )
    add(
        stat(
            layout.id(),
            "Resident memory",
            f'sum(mongodb_ss_mem_resident{{{service_sel}}})',
            "decmbytes",
            8,
            y,
            8,
            4,
            description="MongoDB resident memory in megabytes.",
        )
    )
    add(
        stat(
            layout.id(),
            "Operations / sec",
            f'sum(rate(mongodb_ss_opcounters{{{service_sel}}}[{RATE}]))',
            "ops",
            16,
            y,
            8,
            4,
            description="Total MongoDB opcounter rate.",
        )
    )
    layout.y += 4

    add(row(layout.id(), "Connections", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Connections current / available",
            f'mongodb_ss_connections{{{service_sel},conn_type="current"}}',
            "current",
            "short",
            0,
            y,
            description="Current and available MongoDB connection slots.",
            legend_mode="table",
            tooltip="multi",
            extra=[
                (
                    f'mongodb_ss_connections{{{service_sel},conn_type="available"}}',
                    "available",
                )
            ],
        )
    )
    add(
        bargauge(
            layout.id(),
            "Connection usage",
            f'sum by (service) (mongodb_ss_connections{{{service_sel},conn_type="current"}}) / clamp_min(sum by (service) (mongodb_ss_connections{{{service_sel},conn_type="current"}}) + sum by (service) (mongodb_ss_connections{{{service_sel},conn_type="available"}}), 1)',
            12,
            y,
            12,
            8,
            description="Current connections divided by current + available; orange above 80%, red above 95%.",
            thresholds=usage_thresholds(),
            legend=LEGEND_SERVICE,
        )
    )
    layout.y += 8

    add(row(layout.id(), "Operations", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Opcounters by type",
            f'sum by (legacy_op_type) (rate(mongodb_ss_opcounters{{{service_sel}}}[{RATE}]))',
            "{{legacy_op_type}}",
            "ops",
            0,
            y,
            description="Insert, query, update, delete, getmore and command rates.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    add(
        timeseries(
            layout.id(),
            "Document operations by type",
            f'sum by (doc_op_type) (rate(mongodb_ss_metrics_document{{{service_sel}}}[{RATE}]))',
            "{{doc_op_type}}",
            "ops",
            12,
            y,
            description="Inserted, returned, updated and deleted documents per second.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    layout.y += 8

    add(row(layout.id(), "Memory and cache", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Memory resident / virtual",
            f'mongodb_ss_mem_resident{{{service_sel}}}',
            "resident",
            "decmbytes",
            0,
            y,
            description="MongoDB resident and virtual memory in megabytes.",
            legend_mode="table",
            tooltip="multi",
            extra=[(f'mongodb_ss_mem_virtual{{{service_sel}}}', "virtual")],
        )
    )
    add(
        timeseries(
            layout.id(),
            "WiredTiger cache bytes",
            f'mongodb_ss_wt_cache_bytes_currently_in_the_cache{{{service_sel}}}',
            "in cache",
            "bytes",
            12,
            y,
            description="Bytes currently in cache, tracked dirty bytes and the configured maximum.",
            legend_mode="table",
            tooltip="multi",
            extra=[
                (
                    f'mongodb_ss_wt_cache_tracked_dirty_bytes_in_the_cache{{{service_sel}}}',
                    "dirty",
                ),
                (
                    f'mongodb_ss_wt_cache_maximum_bytes_configured{{{service_sel}}}',
                    "maximum",
                ),
            ],
        )
    )
    layout.y += 8
    y = layout.y
    add(
        bargauge(
            layout.id(),
            "Cache usage",
            f'mongodb_ss_wt_cache_bytes_currently_in_the_cache{{{service_sel}}} / clamp_min(mongodb_ss_wt_cache_maximum_bytes_configured{{{service_sel}}}, 1)',
            0,
            y,
            12,
            6,
            description="Cache bytes divided by the configured maximum; orange above 80%, red above 95%.",
            thresholds=usage_thresholds(),
            legend="cache",
        )
    )
    add(
        stat(
            layout.id(),
            "Dirty cache bytes",
            f'mongodb_ss_wt_cache_tracked_dirty_bytes_in_the_cache{{{service_sel}}}',
            "bytes",
            12,
            y,
            12,
            6,
            description="Dirty bytes currently tracked by WiredTiger.",
        )
    )
    layout.y += 6

    add(row(layout.id(), "Network", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Network bytes / sec",
            f'rate(mongodb_ss_network_bytesIn{{{service_sel}}}[{RATE}])',
            "in",
            "Bps",
            0,
            y,
            24,
            8,
            description="MongoDB network ingress and egress per second.",
            legend_mode="table",
            tooltip="multi",
            extra=[(f'rate(mongodb_ss_network_bytesOut{{{service_sel}}}[{RATE}])', "out")],
        )
    )
    layout.y += 8

    add(row(layout.id(), "Locks and documents", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Global lock queue",
            f'mongodb_ss_globalLock_currentQueue{{{service_sel}}}',
            "{{count_type}}",
            "short",
            0,
            y,
            description="Global lock queue length for readers, writers and total.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    add(
        timeseries(
            layout.id(),
            "Objects by database",
            f'mongodb_dbstats_objects{{{service_sel},database=~"$database"}}',
            "{{database}}",
            "short",
            12,
            y,
            description="Document/object count per MongoDB database.",
            legend_mode="table",
            tooltip="multi",
        )
    )
    layout.y += 8

    add(row(layout.id(), "Exporter", layout.y))
    layout.y += 1
    y = layout.y
    add(
        stat(
            layout.id(),
            "Exporter CPU",
            f'rate(process_cpu_seconds_total{{job="triplanner-mongodb"}}[{RATE}])',
            "percentunit",
            0,
            y,
            8,
            4,
            description="CPU cores used by the MongoDB exporter.",
        )
    )
    add(
        stat(
            layout.id(),
            "Exporter memory",
            'process_resident_memory_bytes{job="triplanner-mongodb"}',
            "bytes",
            8,
            y,
            8,
            4,
            description="Resident memory of the MongoDB exporter.",
        )
    )
    add(
        stat(
            layout.id(),
            "Goroutines",
            'go_goroutines{job="triplanner-mongodb"}',
            "short",
            16,
            y,
            8,
            4,
            description="Exporter goroutines.",
            graph_mode="none",
        )
    )
    layout.y += 4
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Exporter CPU trend",
            f'rate(process_cpu_seconds_total{{job="triplanner-mongodb"}}[{RATE}])',
            "cpu",
            "percentunit",
            0,
            y,
            12,
            description="CPU cores used by the MongoDB exporter over time.",
            legend_mode="list",
            tooltip="single",
        )
    )
    add(
        timeseries(
            layout.id(),
            "Exporter memory trend",
            'process_resident_memory_bytes{job="triplanner-mongodb"}',
            "memory",
            "bytes",
            12,
            y,
            12,
            description="Resident memory of the MongoDB exporter over time.",
            legend_mode="list",
            tooltip="single",
        )
    )
    layout.y += 8

    return dashboard(
        "triplanner-mongodb",
        "Triplanner / MongoDB",
        "Connections, operations, WiredTiger cache, network and locks for the locations catalogue.",
        ["mongodb", "database"],
        panels,
        [
            datasource_variable(),
            query_variable("service", "Instance", "label_values(mongodb_up, service)"),
            query_variable(
                "database",
                "Database",
                'label_values(mongodb_dbstats_objects{service=~"$service"}, database)',
            ),
        ],
        MONGO_LINKS,
    )


def overview_dashboard() -> dict[str, Any]:
    layout = Layout()
    panels: list[dict[str, Any]] = []
    service_selector = 'service=~"$service"'

    def add(panel: dict[str, Any]) -> None:
        panels.append(panel)

    add(row(layout.id(), "Health", layout.y))
    layout.y += 1
    y = layout.y
    add(
        table(
            layout.id(),
            "Service health (all)",
            'up{job=~"triplanner-.*"}',
            0,
            y,
            12,
            10,
            description="Prometheus scrape health for every Triplanner runtime.",
            mappings=up_mappings(),
            thresholds=up_thresholds(),
            transformations=[
                {
                    "id": "organize",
                    "options": {
                        "excludeByName": {
                            "Time": True,
                            "__name__": True,
                            "service": True,
                            "instance": True,
                            "namespace": True,
                            "container": True,
                            "endpoint": True,
                            "pod": True,
                        },
                        "renameByName": {"job": "Service", "Value": "Up"},
                    },
                }
            ],
        )
    )
    add(
        table(
            layout.id(),
            "Build info",
            f'triplanner_build_info{{{service_selector}}}',
            12,
            y,
            12,
            10,
            description="Build metadata for the selected services.",
            transformations=[
                {
                    "id": "organize",
                    "options": {
                        "excludeByName": {
                            "Time": True,
                            "__name__": True,
                            "job": True,
                            "instance": True,
                            "namespace": True,
                            "container": True,
                            "endpoint": True,
                            "pod": True,
                        },
                        "renameByName": {
                            "service": "Service",
                            "version": "Version",
                            "Value": "Present",
                        },
                    },
                }
            ],
        )
    )
    layout.y += 10

    add(row(layout.id(), "Traffic", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Requests by service",
            rate_expr("triplanner_http_requests_total", service_selector, "service"),
            LEGEND_SERVICE,
            "reqps",
            0,
            y,
            12,
            10,
            description="Request rate for each selected service.",
            legend_mode="list",
            tooltip="multi",
        )
    )
    add(
        timeseries(
            layout.id(),
            "5xx ratio by service",
            error_ratio_expr(service_selector, "service"),
            LEGEND_SERVICE,
            "percentunit",
            12,
            y,
            12,
            10,
            description="5xx share per service; orange above 1%, red above 5%.",
            thresholds=error_thresholds(),
            color_mode="thresholds",
            thresholds_style="line",
            min_value=0,
            max_value=1,
            legend_mode="list",
            tooltip="multi",
        )
    )
    layout.y += 10

    add(row(layout.id(), "gRPC", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "gRPC calls by service",
            rate_expr("triplanner_grpc_requests_total", service_selector, "service"),
            LEGEND_SERVICE,
            "reqps",
            0,
            y,
            12,
            10,
            description="gRPC call rate for the selected services; only users, trips and locations expose it.",
            legend_mode="list",
            tooltip="multi",
        )
    )
    add(
        timeseries(
            layout.id(),
            "gRPC latency by service (p50 / p95)",
            quantile_expr(
                "triplanner_grpc_request_duration_seconds",
                service_selector,
                0.50,
                "le, service",
            ),
            f"p50 {LEGEND_SERVICE}",
            "s",
            12,
            y,
            12,
            10,
            description="p50 baseline and p95 tail gRPC call duration per selected service.",
            legend_mode="list",
            tooltip="multi",
            extra=[
                (
                    quantile_expr(
                        "triplanner_grpc_request_duration_seconds",
                        service_selector,
                        0.95,
                        "le, service",
                    ),
                    f"p95 {LEGEND_SERVICE}",
                )
            ],
        )
    )
    layout.y += 10

    add(row(layout.id(), "Status and latency", layout.y))
    layout.y += 1
    y = layout.y
    add(
        timeseries(
            layout.id(),
            "Requests by status",
            rate_expr("triplanner_http_requests_total", service_selector, "status"),
            LEGEND_STATUS,
            "reqps",
            0,
            y,
            12,
            10,
            description="Request rate by HTTP status across the selected services.",
            legend_mode="list",
            tooltip="multi",
        )
    )
    add(
        timeseries(
            layout.id(),
            "Latency by service (p50 / p95)",
            quantile_expr(
                "triplanner_http_request_duration_seconds",
                service_selector,
                0.50,
                "le, service",
            ),
            f"p50 {LEGEND_SERVICE}",
            "s",
            12,
            y,
            12,
            10,
            description="p50 baseline and p95 tail request duration per selected service.",
            legend_mode="list",
            tooltip="multi",
            extra=[
                (
                    quantile_expr(
                        "triplanner_http_request_duration_seconds",
                        service_selector,
                        0.95,
                        "le, service",
                    ),
                    f"p95 {LEGEND_SERVICE}",
                )
            ],
        )
    )

    return dashboard(
        "triplanner-overview",
        "Triplanner / Overview",
        "One-page health, traffic and latency view for all Triplanner runtimes.",
        ["overview"],
        panels,
        [
            datasource_variable(),
            query_variable(
                "service",
                "Service",
                "label_values(triplanner_http_requests_total, service)",
            ),
        ],
        OVERVIEW_LINKS,
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    dashboards = {
        "overview": overview_dashboard(),
        "postgres": postgres_dashboard(),
        "mongodb": mongodb_dashboard(),
    }
    dashboards.update({svc["key"]: service_dashboard(svc) for svc in SERVICES})
    for name, value in dashboards.items():
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
