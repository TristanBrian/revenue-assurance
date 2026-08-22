"""
Periodically-refreshed fraud-graph snapshot, feeding the
graph_community_size feature in feature_builder.py.

Louvain clustering (graph_engine.py's build_fraud_graph()/
build_outbound_fraud_graph()) is a full-graph recompute — not something
to rerun per single new anomaly at real-time-scoring speed. Per the
fraud-scoring spec's explicit real-time constraint: refresh on a short
interval (same cadence class as the audit trail's anchor-batch trigger),
and at scoring time look up the actor's community membership from the
latest snapshot rather than reclustering live. A few-minutes-stale graph
feature is an acceptable trade for genuinely real-time per-anomaly
scoring on everything else.

In-memory only (module-level dict) — this is a derived, disposable cache
recomputable at any time from the DB, same posture as app/core/cache.py's
reconciliation result cache. Losing it on a restart just means the first
few scoring calls after boot see graph_community_size=0.0 until the first
refresh completes, not a correctness problem.
"""
import asyncio
import logging

from app.services.fraud import graph_engine

logger = logging.getLogger("kpc.fraud.graph_snapshot")

REFRESH_INTERVAL_SECONDS = 5 * 60  # same cadence class as anchor_service.py's batch/timer trigger

# {"inbound": {actor_key: {"community_id": int, "community_size": int}}, "outbound": {...}}
_snapshot: dict = {"inbound": {}, "outbound": {}}


def _index_by_actor_label(graph_result: dict) -> dict:
    """Builds {node_label: {"community_id", "community_size"}} from a
    build_fraud_graph()/build_outbound_fraud_graph()-shaped result.
    Keyed by label deliberately, not node id ("omc:OMC-001") — an OMC
    node's label IS the OMC's customer_name (see graph_engine.py's
    omc_labels dict), and an officer node's label IS the raw officer_id
    — both exactly match feature_builder._actor_key()'s values, so no
    extra id-mapping join is needed downstream. Depot/beneficiary nodes
    are skipped: graph_community_size is an actor-level (OMC/officer)
    feature, not a per-location/per-beneficiary one — see
    feature_builder._actor_key()'s docstring for why officer_id, not
    beneficiary_id, is the outbound actor key."""
    community_size_by_id = {c["id"]: c["member_count"] for c in graph_result.get("communities", [])}
    index = {}
    for node in graph_result.get("nodes", []):
        if node["type"] not in ("omc", "officer"):
            continue
        index[node["label"]] = {
            "community_id": node["community"],
            "community_size": community_size_by_id.get(node["community"], 0),
        }
    return index


def refresh_snapshot() -> None:
    """Synchronous, one-shot refresh — called by the periodic background
    loop, and directly by scripts/train_fraud_model.py (which wants one
    fresh snapshot before scoring the training set, not a running
    background task of its own)."""
    global _snapshot
    try:
        inbound_graph = graph_engine.build_fraud_graph(materiality=0)
        outbound_graph = graph_engine.build_outbound_fraud_graph(materiality=0)
        _snapshot = {
            "inbound": _index_by_actor_label(inbound_graph),
            "outbound": _index_by_actor_label(outbound_graph),
        }
        logger.info(
            f"✅ Fraud graph snapshot refreshed: "
            f"{len(_snapshot['inbound'])} inbound actors, {len(_snapshot['outbound'])} outbound actors."
        )
    except Exception as exc:
        # Non-fatal, same posture as anchor_service.py's periodic check —
        # a failed refresh just means scoring keeps using the last good
        # snapshot (or an empty one, pre-first-refresh) until the next tick.
        logger.error(f"Fraud graph snapshot refresh failed (non-fatal, retried next tick): {exc}")


def get_snapshot(direction: str) -> dict:
    """direction: "inbound" | "outbound". Returns {} if that direction
    hasn't been populated yet (e.g. called before the first refresh)."""
    return _snapshot.get(direction, {})


async def run_periodic_graph_snapshot_refresh(interval_seconds: int = REFRESH_INTERVAL_SECONDS) -> None:
    """Background loop — started from app/main.py's lifespan alongside
    the audit-anchor check, cancelled on shutdown. Mirrors
    anchor_service.run_periodic_anchor_check()'s exact loop shape."""
    while True:
        try:
            # Runs the (synchronous, DB-querying) refresh in a thread so
            # it doesn't block the event loop for however long the
            # Louvain recompute takes on the full anomaly set.
            await asyncio.to_thread(refresh_snapshot)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"Periodic graph snapshot refresh loop error (non-fatal): {exc}")
        await asyncio.sleep(interval_seconds)
