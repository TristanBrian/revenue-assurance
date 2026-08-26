"""Near-real-time Inuka event adapter.

The hackathon uses a synthetic simulator, but the adapter is deliberately
HTTP/DB shaped: a production registry, attendance system, authorisation
workflow, bank/M-Pesa feed, or field app can POST the same event contract.
Events are persisted in a small bronze table so the demo survives page
refreshes and the reconciliation layer can consume them on the next run.
"""
import asyncio
import json
import logging
import os
import random
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from app.utils.db_connection import get_engine

logger = logging.getLogger(__name__)
PILLARS = ("Scholarship", "Plus", "Vocational", "Tech")
EVENT_TYPES = ("attendance.recorded", "authorization.approved", "disbursement.posted", "verification.captured")


def ensure_stream_table() -> None:
    with get_engine().begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS inuka_stream_events (
                id BIGSERIAL PRIMARY KEY,
                event_type VARCHAR(80) NOT NULL,
                pillar VARCHAR(40) NOT NULL,
                beneficiary_id VARCHAR(80),
                payload JSONB NOT NULL,
                source_system VARCHAR(120) NOT NULL,
                received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                processed_at TIMESTAMPTZ
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_inuka_stream_received_at ON inuka_stream_events (received_at DESC)"))


def record_event(event: dict[str, Any]) -> dict[str, Any]:
    ensure_stream_table()
    received_at = datetime.now(timezone.utc)
    with get_engine().begin() as conn:
        row = conn.execute(text("""
            INSERT INTO inuka_stream_events
              (event_type, pillar, beneficiary_id, payload, source_system, received_at)
            VALUES (:event_type, :pillar, :beneficiary_id, CAST(:payload AS JSONB), :source_system, :received_at)
            RETURNING id
        """), {
            "event_type": event["event_type"],
            "pillar": event["pillar"],
            "beneficiary_id": event.get("beneficiary_id"),
            "payload": json.dumps(event),
            "source_system": event.get("source_system", "demo-simulator"),
            "received_at": received_at,
        }).scalar_one()
    return {**event, "id": row, "received_at": received_at.isoformat()}


def recent_events(limit: int = 25) -> list[dict[str, Any]]:
    ensure_stream_table()
    with get_engine().connect() as conn:
        rows = conn.execute(text("""
            SELECT id, event_type, pillar, beneficiary_id, payload, source_system,
                   received_at, processed_at
            FROM inuka_stream_events ORDER BY received_at DESC LIMIT :limit
        """), {"limit": limit}).mappings().all()
    return [dict(row) for row in rows]


def stream_status() -> dict[str, Any]:
    ensure_stream_table()
    with get_engine().connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM inuka_stream_events")).scalar_one()
        latest = conn.execute(text("SELECT MAX(received_at) FROM inuka_stream_events")).scalar_one()
    return {
        "mode": "synthetic_near_real_time" if os.getenv("INUKA_STREAM_SIMULATOR", "true").lower() == "true" else "ingestion_only",
        "pillars": list(PILLARS),
        "events_received": count,
        "last_event_at": latest.isoformat() if latest else None,
        "source_contract": "POST /api/inuka/stream/events",
    }


def _demo_event() -> dict[str, Any]:
    return {
        "event_type": random.choice(EVENT_TYPES),
        "pillar": random.choice(PILLARS),
        "beneficiary_id": f"BEN-{random.randint(1, 195):04d}",
        "source_system": "inuka-demo-simulator",
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "evidence_reference": f"EV-{random.randint(100000, 999999)}",
    }


async def run_inuka_stream() -> None:
    if os.getenv("INUKA_STREAM_SIMULATOR", "true").lower() != "true":
        logger.info("Inuka stream simulator disabled; ingestion endpoint remains available")
        return
    interval = max(5, int(os.getenv("INUKA_STREAM_INTERVAL_SECONDS", "15")))
    logger.info("Starting Inuka near-real-time simulator: interval=%ss", interval)
    ensure_stream_table()
    while True:
        try:
            event = record_event(_demo_event())
            logger.info("Inuka stream event received: %s %s %s", event["event_type"], event["pillar"], event["beneficiary_id"])
        except Exception:
            logger.exception("Inuka stream simulator event failed")
        await asyncio.sleep(interval)
