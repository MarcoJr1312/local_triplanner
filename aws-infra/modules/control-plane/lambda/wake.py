import json
import os
import urllib.request
from datetime import datetime, timezone

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
            "client_payload": {"source": "triplanner-wake-lambda"},
        }
    ).encode()
    request = urllib.request.Request(
        f"https://api.github.com/repos/{os.environ['GITHUB_REPO']}/dispatches",
        data=body,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {_token()}",
            "Content-Type": "application/json",
            "User-Agent": "triplanner-wake",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return response.status


def handler(event, context):
    table = _table()
    item = table.get_item(Key={"key": "stack"}).get("Item", {})
    state = item.get("state", "asleep")

    if state in ("awake", "waking"):
        return {
            "statusCode": 200,
            "headers": {"content-type": "application/json"},
            "body": json.dumps({"state": state}),
        }

    table.put_item(
        Item={
            "key": "stack",
            "state": "waking",
            "updated_at": _now(),
            "last_activity_at": _now(),
        }
    )

    try:
        _dispatch("wake")
    except Exception as exc:  # noqa: BLE001
        table.put_item(
            Item={
                "key": "stack",
                "state": "asleep",
                "updated_at": _now(),
                "error": str(exc),
            }
        )
        return {
            "statusCode": 502,
            "headers": {"content-type": "application/json"},
            "body": json.dumps({"state": "asleep", "error": str(exc)}),
        }

    return {
        "statusCode": 202,
        "headers": {"content-type": "application/json"},
        "body": json.dumps({"state": "waking"}),
    }
