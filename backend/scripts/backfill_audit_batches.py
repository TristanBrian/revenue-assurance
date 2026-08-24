"""
backfill_audit_batches.py — ONE-TIME, OPTIONAL, OFFLINE job that buckets
the pre-cutover audit_logs rows (block_hash IS NOT NULL) into
AuditLogBatch entries, purely so historical rows can benefit from fast,
O(log n) Merkle-proof spot-checks (merkle_service.get_merkle_proof()/
verify_row_in_batch()) instead of walking the whole legacy prefix. See
docs/audit-merkle-migration.md Part 5.6 for the full reasoning.

What this deliberately does NOT do:
  - Anchor anything new on-chain. Those anchor events already happened
    (or didn't) back when each pre-cutover row was actually written —
    this script can't retroactively change what's permanently committed
    on Base Sepolia, and doesn't try to.
  - Touch verify_chain_integrity()'s automatic walk. Backfilled batches
    are marked is_backfilled=True and are explicitly excluded from
    _verify_batch_era()'s live sequence (see that function and
    AuditLogBatch.is_backfilled's own docstring) — they exist purely as
    an optional convenience for a targeted spot-check, not as a
    replacement for the legacy chain's own real verification path
    (_verify_legacy_chain(), still the source of truth for pre-cutover
    rows).
  - Chain into the live batch_index/batch_root_hash sequence at all.
    Backfilled batches use NEGATIVE batch_index values (counting down
    from -1 for the newest backfilled batch) specifically so they can
    never collide with or be mistaken for a live batch, and the newest
    backfilled batch's prev_batch_root_hash is its own
    GENESIS_PREV_HASH, not whatever the live sequence's tip happens to
    be — these are two independent chains-of-batches, not one.

This is a real (if bounded) amount of work at real historical row counts
(~1.9M rows observed in this deployment as of the cutover) — streamed via
a server-side cursor, same pattern as seal_batch()/verify_chain_
integrity(), so it won't repeat the original OOM, but it will take a real
amount of wall-clock time. Run it once, offline, against a copy of the
data first if you want to sanity-check the row count/timing before
running it against the live DB.

Usage (from backend/, after the batch Merkle cutover has shipped):
    python scripts/backfill_audit_batches.py
    python scripts/backfill_audit_batches.py --dry-run   # counts batches, writes nothing
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.audit.audit import AuditLog  # noqa: E402
from app.models.audit.audit_log_batch import AuditLogBatch  # noqa: E402
from app.services.audit import merkle_service  # noqa: E402
from app.services.audit.audit_service import GENESIS_PREV_HASH  # noqa: E402
from app.utils.db_connection import SessionLocal  # noqa: E402


def _iter_legacy_batches(db, batch_size: int):
    """Yields lists of (block_index, data_hash) tuples, chunked to
    batch_size, ordered by block_index ascending — the exact same
    streaming pattern seal_batch() uses for live batches, applied here
    to the fixed pre-cutover prefix instead."""
    query = (
        db.query(AuditLog.block_index, AuditLog.data_hash)
        .filter(AuditLog.block_hash.isnot(None))
        .order_by(AuditLog.block_index.asc())
        .execution_options(stream_results=True)
        .yield_per(batch_size)
    )
    chunk: list[tuple[int, str]] = []
    for block_index, data_hash in query:
        chunk.append((block_index, data_hash))
        if len(chunk) >= batch_size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Count rows/batches and print what would be written, without writing anything.",
    )
    parser.add_argument(
        "--batch-size", type=int, default=merkle_service.MAX_BATCH_SIZE,
        help=f"Rows per backfilled batch (default: {merkle_service.MAX_BATCH_SIZE}, same cap live batches use).",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        already_backfilled = db.query(AuditLogBatch).filter(AuditLogBatch.is_backfilled.is_(True)).count()
        if already_backfilled > 0:
            print(
                f"⚠️  {already_backfilled} backfilled batch(es) already exist — this script does not "
                "re-backfill or check for a partial prior run. Investigate before proceeding "
                "(a second run would produce a second, disconnected backfilled chain, "
                "confusing rather than harmful given backfill is spot-check-only, but still not intended)."
            )
            return

        print("🔄 Streaming pre-cutover rows and building batches...")
        # Newest-first assignment: the LAST chunk streamed (highest
        # block_index, closest to the cutover) becomes batch_index=-1,
        # working backward from there — see module docstring for why
        # negative, descending-toward-genesis indexing was chosen.
        chunks = list(_iter_legacy_batches(db, args.batch_size))
        if not chunks:
            print("ℹ️  No pre-cutover rows found — nothing to backfill.")
            return

        total_rows = sum(len(c) for c in chunks)
        print(f"📊 {total_rows} pre-cutover rows across {len(chunks)} batch(es) of up to {args.batch_size} rows.")

        if args.dry_run:
            print("✅ Dry run — nothing written.")
            return

        prev_batch_root_hash = GENESIS_PREV_HASH
        batch_index = -len(chunks)
        for i, chunk in enumerate(chunks):
            start_block_index = chunk[0][0]
            end_block_index = chunk[-1][0]
            data_hashes = [dh for _, dh in chunk]

            tree = merkle_service.build_merkle_tree(data_hashes)
            batch_root_hash = merkle_service.compute_batch_root_hash(
                batch_index=batch_index,
                start_block_index=start_block_index,
                end_block_index=end_block_index,
                merkle_root_hex=tree.root_hex,
                prev_batch_root_hash_hex=prev_batch_root_hash,
            )

            db.add(AuditLogBatch(
                batch_index=batch_index,
                start_block_index=start_block_index,
                end_block_index=end_block_index,
                row_count=len(chunk),
                merkle_root=tree.root_hex,
                prev_batch_root_hash=prev_batch_root_hash,
                batch_root_hash=batch_root_hash,
                is_backfilled=True,
            ))
            print(
                f"  batch_index={batch_index}: block_index {start_block_index}-{end_block_index} "
                f"({len(chunk)} rows), merkle_root={tree.root_hex[:16]}..."
            )

            prev_batch_root_hash = batch_root_hash
            batch_index += 1

        db.commit()
        print(f"✅ Backfilled {len(chunks)} batch(es) covering {total_rows} pre-cutover rows.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
