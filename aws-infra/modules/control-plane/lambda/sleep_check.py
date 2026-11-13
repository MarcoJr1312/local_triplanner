import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone

import boto3


def _table():
    return boto3.resource("dynamodb").Table(os.environ["CONTROL_TABLE"])


def _now():
    return datetime.now(timezone.utc).isoformat()


def _token():
    sm = boto3.client("secretsmanager")
    return sm.get_secret_value(SecretId=os.environ["GITHUB_TOKEN_SECRET_ARN"])["SecretString"]


def _dispatch(event_type):
    body = json.dumps(
        {
            "event_type": event_type,
            "client_payload": {"source": "triplanner-sleep-check"},
        }
    ).encode()
    request = urllib.request.Request(
        f"https://api.github.com/repos/{os.environ['GITHUB_REPO']}/dispatches",
        data=body,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {_token()}",
            "Content-Type": "application/json",
            "User-Agent": "triplanner-sleep",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return response.status


def _alb_suffix():
    elbv2 = boto3.client("elbv2")
    lbs = elbv2.describe_load_balancers(Names=[os.environ["ALB_NAME"]])["LoadBalancers"]
    if not lbs:
        return None
    return lbs[0]["LoadBalancerArn"].split(":loadbalancer/")[1]


def handler(event, context):
    table = _table()
    item = table.get_item(Key={"key": "stack"}).get("Item", {})
    state = item.get("state", "asleep")

    if state != "awake":
        return {"state": state}

    alb_suffix = _alb_suffix()
    if not alb_suffix:
        return {"state": "awake", "note": "alb-not-found"}

    idle_minutes = int(os.environ.get("IDLE_MINUTES", "30"))
    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=idle_minutes)

    cw = boto3.client("cloudwatch")
    response = cw.get_metric_data(
        MetricDataQueries=[
            {
                "Id": "requests",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/ApplicationELB",
                        "MetricName": "RequestCount",
                        "Dimensions": [{"Name": "LoadBalancer", "Value": alb_suffix}],
                    },
                    "Period": 300,
                    "Stat": "Sum",
                },
                "ReturnData": True,
            },
            {
                "Id": "connections",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/ApplicationELB",
                        "MetricName": "ActiveConnectionCount",
                        "Dimensions": [{"Name": "LoadBalancer", "Value": alb_suffix}],
                    },
                    "Period": 300,
                    "Stat": "Maximum",
                },
                "ReturnData": True,
            },
        ],
        StartTime=start,
        EndTime=end,
    )

    values = {result["Id"]: result["Values"] for result in response["MetricDataResults"]}
    requests = sum(values.get("requests", []))
    connections = max(values.get("connections", [0]) or [0])

    if requests > 0 or connections > 0:
        table.update_item(
            Key={"key": "stack"},
            UpdateExpression="SET last_activity_at = :now",
            ExpressionAttributeValues={":now": end.isoformat()},
        )
        return {"state": "awake", "requests": requests, "connections": connections}

    try:
        _dispatch("sleep")
    except Exception as exc:  # noqa: BLE001
        return {"state": "awake", "error": str(exc)}

    table.put_item(
        Item={
            "key": "stack",
            "state": "sleeping",
            "updated_at": end.isoformat(),
            "last_activity_at": item.get("last_activity_at", ""),
        }
    )
    return {"state": "sleeping", "requests": 0, "connections": 0}
