#!/usr/bin/env python3
"""webhook-receiver.py — runnable Rain spend-webhook receiver (FastAPI).

Pipeline: verify signature -> dedupe on envelope id -> order by eventReceivedAt
          -> route by action -> return 200 FAST (heavy work goes async).

Run:
    pip install "fastapi[standard]" uvicorn
    RAIN_API_KEY=sk_dev_... uvicorn webhook-receiver:app --port 3000
    # expose publicly (loopback is blocked by Rain): ngrok http 3000
    # register the ngrok https URL in the Rain developer dashboard.

Rain-Managed: you CANNOT approve/decline. `transaction.requested` only shows up
in sandbox — this receiver ignores it. `transaction.created` is the truth.
"""

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, Request, Response

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("rain-webhooks")

RAIN_API_KEY = os.environ.get("RAIN_API_KEY")  # doubles as the webhook signing secret
if not RAIN_API_KEY:
    raise RuntimeError("Set RAIN_API_KEY (your API key value = webhook signing secret).")

app = FastAPI()

# In-memory stores — swap for Redis / your DB in production.
_processed_delivery_ids: set[str] = set()           # envelope id -> already handled
_last_event_ms_by_txn: dict[str, float] = {}         # body.id -> latest eventReceivedAt (ms)


# ---------------------------------------------------------------------------
# Step 2 — signature verification (raw body, constant-time, secondary fallback).
# Mirrors scripts/verify-signature.py and the rain-api-auth scheme.
# ---------------------------------------------------------------------------
def verify_rain_signature(raw_body: bytes, headers, api_key: str) -> bool:
    expected = hmac.new(api_key.encode(), raw_body, hashlib.sha256).hexdigest()
    for header_name in ("signature", "secondary-signature"):
        provided = headers.get(header_name)
        if not provided:
            continue
        if hmac.compare_digest(provided.strip(), expected):  # constant-time
            return True
    return False


# ---------------------------------------------------------------------------
# Step 4 — idempotency + ordering helpers.
# ---------------------------------------------------------------------------
def already_processed(delivery_id: str) -> bool:
    if delivery_id in _processed_delivery_ids:
        return True
    _processed_delivery_ids.add(delivery_id)
    return False


def is_in_order(txn_id: str, event_received_at: Optional[str]) -> bool:
    """False if this event is OLDER than one already applied for the same txn.

    Only meaningful when eventReceivedAt is present — it is OFF by default for
    spend (enable via your account manager). Without it, design handlers to be
    order-tolerant (upsert by body.id; completed is terminal).
    """
    if not event_received_at:
        return True
    try:
        ts = datetime.fromisoformat(event_received_at.replace("Z", "+00:00"))
        ms = ts.astimezone(timezone.utc).timestamp() * 1000.0
    except ValueError:
        return True
    last = _last_event_ms_by_txn.get(txn_id)
    if last is not None and ms < last:
        return False
    _last_event_ms_by_txn[txn_id] = ms
    return True


# ---------------------------------------------------------------------------
# Step 5 — routing. Enqueue real work; keep the handler fast.
# ---------------------------------------------------------------------------
def route_event(env: dict) -> None:
    body = env.get("body", {})
    if body.get("type") != "spend":
        return
    s = body.get("spend") or {}
    txn_id = body.get("id")
    action = env.get("action")

    if action == "requested":
        # Rain-Managed: NOT delivered in production. Sandbox-only artifact. Ignore.
        log.info("[ignore] requested (sandbox artifact) txn=%s", txn_id)
        return

    if action == "created":
        if s.get("status") == "declined":
            log.info("[declined] txn=%s reason=%r", txn_id, s.get("declinedReason"))
        elif (s.get("amount") or 0) < 0:
            log.info("[refund-auth] txn=%s amount=%s (no credit until settled)", txn_id, s.get("amount"))
        else:
            log.info("[auth] txn=%s amount=%s %s merchant=%r", txn_id, s.get("amount"), s.get("currency"), s.get("merchantName"))
        # PERSIST every created (incl. declines) so updated/completed can reconcile.
        return

    if action == "updated":
        if s.get("status") == "reversed":
            kind = "full" if s.get("amount") == 0 else "partial"
            log.info("[reversal:%s] txn=%s newTotal=%s delta=%s (hold MAINTAINED)",
                     kind, txn_id, s.get("amount"), s.get("authorizationUpdateAmount"))
        elif s.get("status") == "declined":
            log.info("[declined-after-auth] txn=%s reason=%r", txn_id, s.get("declinedReason"))
        else:
            log.info("[incremental] txn=%s newTotal=%s delta=%s",
                     txn_id, s.get("amount"), s.get("authorizationUpdateAmount"))
        return

    if action == "completed":
        log.info("[completed] txn=%s settled=%s reason=%s postedAt=%s",
                 txn_id, s.get("amount"), s.get("completionReason"), s.get("postedAt"))
        if s.get("isForcePosted"):
            log.info("  force-posted; closedAuth=%s", s.get("closedAuthorizationTransactionId"))
        return


# ---------------------------------------------------------------------------
# The endpoint.
# ---------------------------------------------------------------------------
@app.post("/webhooks/rain")
async def rain_webhook(request: Request, background: BackgroundTasks) -> Response:
    raw_body = await request.body()  # raw bytes — verify before parsing

    # Step 2: verify before doing anything.
    if not verify_rain_signature(raw_body, request.headers, RAIN_API_KEY):
        return Response(content=json.dumps({"error": "invalid signature"}),
                        status_code=401, media_type="application/json")

    try:
        env = json.loads(raw_body)  # parse AFTER verifying
    except json.JSONDecodeError:
        return Response(content=json.dumps({"error": "invalid JSON"}),
                        status_code=400, media_type="application/json")

    # Step 4: dedupe on the envelope delivery id.
    if already_processed(env.get("id", "")):
        return Response(content=json.dumps({"received": True, "duplicate": True}),
                        status_code=200, media_type="application/json")

    # Step 4: drop stale out-of-order events (when eventReceivedAt is present).
    if not is_in_order(env.get("body", {}).get("id", ""), env.get("eventReceivedAt")):
        return Response(content=json.dumps({"received": True, "stale": True}),
                        status_code=200, media_type="application/json")

    # Step 5: process async; ack fast.
    background.add_task(route_event, env)

    # Step 3: ack fast with JSON (never HTML — Rain truncates non-JSON responses).
    return Response(content=json.dumps({"received": True}),
                    status_code=200, media_type="application/json")
