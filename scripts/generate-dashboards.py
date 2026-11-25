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
]
SERVICE_LINKS = [dashboard_link("Triplanner overview", "/d/triplanner-overview")]


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
) -> dict[str, Any]:
    value: dict[str, Any] = {
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


def timeseries_field(
    unit: str,
    *,
    thresholds: dict[str, Any] | None = None,
    color_mode: str = "palette-classic",
    thresholds_style: str = "off",
) -> dict[str, Any]:
    return {
        "defaults": {
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
        },
        "overrides": [],
    }


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
) -> dict[str, Any]:
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
    *,
    description: str = "",
    legend_mode: str = "table",
    tooltip: str = "multi",
    thresholds: dict[str, Any] | None = None,
    color_mode: str = "palette-classic",
    thresholds_style: str = "off",
) -> dict[str, Any]:
    return {
        "datasource": DATASOURCE,
        "description": description,
        "fieldConfig": timeseries_field(
            unit,
            thresholds=thresholds,
            color_mode=color_mode,
            thresholds_style=thresholds_style,
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


def p95_expr(service: str, by_route: bool = False) -> str:
    selector = f'service="{service}",route=~"$route"'
    by = "le, route" if by_route else "le"
    return (
        "histogram_quantile(0.95, sum by ("
        + by
        + ") (rate(triplanner_http_request_duration_seconds_bucket{"
        + selector
        + "}["
        + RATE
        + "])))"
    )


def error_ratio_expr(selector: str, by: str = "") -> str:
    """5xx ratio with a zero fallback so healthy services render 0, not No data."""
    errors = rate_expr("triplanner_http_requests_total", selector + ',status=~"5.."', by)
    total = rate_expr("triplanner_http_requests_total", selector, by)
    ratio = errors + " / clamp_min(" + total + ", 0.001)"
    if by:
        return "(" + ratio + ") or (0 * " + total + ")"
    return "(" + ratio + ") or vector(0)"


def service_dashboard(svc: dict[str, str]) -> dict[str, Any]:
    layout = Layout()
    panels: list[dict[str, Any]] = []
    service = svc["service"]
    job = svc["job"]
    service_route = f'service="{service}",route=~"$route"'

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
            5,
            4,
            description="Share of requests returning 5xx; orange above 1%, red above 5%.",
            thresholds=error_thresholds(),
        )
    )
    add(
        stat(
            layout.id(),
            "p95 latency",
            p95_expr(service),
            "s",
            14,
            y,
            5,
            4,
            description="p95 request duration; orange above 500 ms, red above 1 s.",
            thresholds=latency_thresholds(),
        )
    )
    add(
        stat(
            layout.id(),
            "In flight",
            f'sum(triplanner_http_requests_in_flight{{service="{service}"}})',
            "short",
            19,
            y,
            5,
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
            "p95 by route",
            p95_expr(service, by_route=True),
            LEGEND_ROUTE,
            "s",
            12,
            y,
            description="p95 latency per route template.",
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
            legend_mode="list",
            tooltip="multi",
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
            "p95 latency by service",
            "histogram_quantile(0.95, sum by (le, service) (rate(triplanner_http_request_duration_seconds_bucket{"
            + service_selector
            + "}["
            + RATE
            + "])))",
            LEGEND_SERVICE,
            "s",
            12,
            y,
            12,
            10,
            description="p95 request duration per selected service.",
            legend_mode="list",
            tooltip="multi",
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
    dashboards = {"overview": overview_dashboard()}
    dashboards.update({svc["key"]: service_dashboard(svc) for svc in SERVICES})
    for name, value in dashboards.items():
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
