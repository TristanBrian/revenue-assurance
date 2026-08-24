"""
On-chain anchoring for the immutable audit trail — periodically commits
the audit_logs hash chain's current tip to AuditAnchor.sol on Base
Sepolia (see web3/contracts/AuditAnchor.sol). Same three-step CDP flow
as Mavuno_Pay_API's escrow_service.py/trace_service.py (this codebase's
established reference for CDP-signed on-chain writes — see that
project's app/services/escrow_service.py):

  1. web3.py builds the unsigned anchor() transaction locally — only
     reads chain state (nonce, gas price), no private key involved.
  2. Wrapped in a TransactionRequestEIP1559.
  3. The CDP account signs server-side in the TEE and broadcasts via
     account.send_transaction(network="base-sepolia"). No private key
     is ever held by this process.

Never writes raw beneficiary/financial data on-chain — only
audit_logs.block_hash (a sha256 hex string, converted to bytes32) and
the block_index it belongs to. See AuditAnchor.sol's module docstring.

Not configured (no AUDIT_ANCHOR_CONTRACT_ADDRESS, or no CDP
credentials) is a normal, expected state — same "not configured, not an
error" posture as app/services/alerts/alert_service.py's SMTP handling —
not an exception every caller has to catch. is_configured() is the gate;
callers check it (or just call the function, which no-ops through it).
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session
from web3 import Web3

from app.config import settings
from app.models.audit.audit_anchor import AuditAnchorRecord
from app.models.audit.audit_log_batch import AuditLogBatch
from app.services.audit.audit_service import GENESIS_PREV_HASH, get_legacy_chain_tip, recompute_block_hash_at

logger = logging.getLogger("kpc.audit.anchor")

NETWORK = "base-sepolia"
CHAIN_ID = 84532

# Anchor trigger rule (Section 3 of the extension spec): whichever comes
# first. Polled from a background loop (see run_periodic_anchor_check()
# / main.py's lifespan), not driven per-event — there's no event bus in
# this codebase to hang a per-event trigger off, same constraint noted
# in the alerts registry's "no job scheduler exists yet" comment.
ANCHOR_EVERY_N_BLOCKS = 50
ANCHOR_EVERY_SECONDS = 5 * 60


# This file lives one level deeper than trace_service.py/escrow_service.py
# (app/services/audit/ vs app/services/) — three dirname() calls to reach
# app/, not two, or ABI_PATH silently resolves to app/services/abi/...
# instead of app/abi/... (caught by actually importing this module, not
# by inspection: is_configured() came back False with AUDIT_ANCHOR_ABI
# unset even though the file genuinely exists at app/abi/AuditAnchor.json).
APP_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# V1 (per-row chain-tip anchor — blockIndex/chainTipHash) vs V2 (batch
# Merkle anchor — batchIndex/merkleRoot/batchRootHash). See
# docs/audit-merkle-migration.md. AuditAnchor.json is the CURRENT (V2)
# ABI going forward; AuditAnchorV1.json is kept solely so pre-cutover
# on-chain anchors (made against the original contract, a different
# address) stay decodable — see fetch_anchor_event() (V1) vs
# fetch_batch_anchor_event() (V2) below.
ABI_PATH_V2 = os.path.join(APP_DIR, "abi", "AuditAnchor.json")
ABI_PATH_V1 = os.path.join(APP_DIR, "abi", "AuditAnchorV1.json")


def _load_abi(path: str) -> Optional[list]:
    try:
        with open(path, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.error(f"AuditAnchor ABI not found at {path} — anchoring will report not-configured.")
        return None


AUDIT_ANCHOR_ABI_V2 = _load_abi(ABI_PATH_V2)
AUDIT_ANCHOR_ABI_V1 = _load_abi(ABI_PATH_V1)
# Backwards-compatible alias — existing code/tests importing
# AUDIT_ANCHOR_ABI (the pre-cutover name) keep working; means "V2, the
# current contract" now, same as it always meant "the current contract."
AUDIT_ANCHOR_ABI = AUDIT_ANCHOR_ABI_V2


def is_configured() -> bool:
    """False means: no V1 contract deployed, or CDP credentials aren't
    set. Gates the LEGACY (pre-cutover) on-chain path specifically —
    verify_on_chain_anchor()'s V1 branch, and anything resolving a
    pre-existing AuditAnchorRecord row with block_index_anchored set.
    Every public function in this module checks the relevant one of
    is_configured()/is_configured_v2() first and returns a "not
    configured" result rather than raising — mirrors
    alert_service.is_configured()'s SMTP gate."""
    return bool(
        AUDIT_ANCHOR_ABI_V1
        and settings.audit_anchor_contract_address
        and settings.cdp_api_key_id
        and settings.cdp_api_key_secret
        and settings.cdp_wallet_secret
    )


def is_configured_v2() -> bool:
    """False means: no V2 (batch Merkle) contract deployed yet, or CDP
    credentials aren't set. Gates anchor_latest_batch()/
    maybe_anchor_latest_batch() and verify_on_chain_anchor()'s V2 branch.
    Independent of is_configured() (V1) — CDP credentials are shared, but
    the two contract addresses are configured/deployed separately (see
    docs/audit-merkle-migration.md Part 3), so one can be configured
    without the other, e.g. immediately after this migration ships and
    before the V2 contract has actually been deployed."""
    return bool(
        AUDIT_ANCHOR_ABI_V2
        and settings.audit_anchor_contract_address_v2
        and settings.cdp_api_key_id
        and settings.cdp_api_key_secret
        and settings.cdp_wallet_secret
    )


def _build_web3() -> Web3:
    return Web3(Web3.HTTPProvider(settings.base_rpc_url))


def _build_contract(w3: Web3):
    """V1 contract — kept name unchanged (pre-existing callers), used
    only for pre-cutover anchor verification now."""
    address = Web3.to_checksum_address(settings.audit_anchor_contract_address)
    return w3.eth.contract(address=address, abi=AUDIT_ANCHOR_ABI_V1)


def _build_contract_v2(w3: Web3):
    address = Web3.to_checksum_address(settings.audit_anchor_contract_address_v2)
    return w3.eth.contract(address=address, abi=AUDIT_ANCHOR_ABI_V2)


def _run(coro):
    """Same sync/async bridge as escrow_service.py/trace_service.py —
    lets this module's public functions be called from plain sync code
    (routes, the background poll loop's non-async caller, scripts)
    without every caller needing to be async."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            raise RuntimeError("anchor_service writes must be awaited inside async endpoints.")
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


def _is_insufficient_balance_error(exc: Exception) -> bool:
    return "insufficient balance" in str(exc).lower()


def _hash_hex_to_bytes32(hash_hex: str) -> bytes:
    """audit_logs.block_hash is a 64-char sha256 hex string (no 0x
    prefix) — the contract's chainTipHash param is bytes32, so this
    needs decoding to raw bytes first."""
    return bytes.fromhex(hash_hex)


async def _get_backend_account_async():
    from cdp import CdpClient

    cdp = CdpClient()
    try:
        account = await cdp.evm.get_or_create_account(name=settings.audit_backend_wallet_name)
        return account.address
    finally:
        await cdp.close()


def get_backend_address() -> Optional[str]:
    """The CDP account's address — the only address AuditAnchor.sol's
    anchor() will accept a call from. None if not configured. Used by
    GET /audit/verify to show which wallet is authorized, for the demo's
    "does the backend's wallet match the contract's `backend`" sanity
    check."""
    if not is_configured():
        return None
    try:
        return _run(_get_backend_account_async())
    except Exception as exc:
        logger.error(f"Could not resolve audit backend wallet address: {exc}")
        return None


async def _send_anchor_tx_async(block_index: int, chain_tip_hash: str) -> Optional[dict]:
    """Builds, signs (via CDP), and broadcasts one anchor() transaction.
    Returns {"tx_hash", "base_block_number"} on success, or None on any
    failure — non-fatal by design, same as trace_service.py's
    _send_log_event_async(): the off-chain chain is already the
    authoritative record regardless of whether this particular anchor
    attempt lands, so a failed anchor here should never block or
    corrupt anything else. The next periodic check simply retries with
    whatever the tip is by then."""
    from cdp import CdpClient
    from cdp.evm_transaction_types import TransactionRequestEIP1559

    w3 = _build_web3()
    contract = _build_contract(w3)

    cdp = CdpClient()
    try:
        account = await cdp.evm.get_or_create_account(name=settings.audit_backend_wallet_name)
        sender = Web3.to_checksum_address(account.address)
        gas_price = w3.eth.gas_price

        tx = contract.functions.anchor(
            block_index,
            _hash_hex_to_bytes32(chain_tip_hash),
        ).build_transaction({
            "from": sender,
            "nonce": w3.eth.get_transaction_count(sender, "pending"),
            "gas": 100_000,
            "gasPrice": gas_price,
            "chainId": CHAIN_ID,
        })

        transaction = TransactionRequestEIP1559(
            to=tx["to"],
            data=tx.get("data") or "0x",
            value=tx.get("value", 0),
            gas=tx.get("gas"),
            nonce=tx.get("nonce"),
            maxFeePerGas=gas_price,
            maxPriorityFeePerGas=gas_price,
            chainId=CHAIN_ID,
        )

        try:
            result = await account.send_transaction(transaction=transaction, network=NETWORK)
        except Exception as exc:
            if not _is_insufficient_balance_error(exc):
                raise
            # Faucet auto-retry — same pattern as escrow_service.py's
            # _send_transaction_async (lines ~117-152 there): request
            # Base Sepolia ETH, wait for it to land, retry once.
            logger.info(f"Audit backend wallet {sender} has insufficient gas — requesting Base Sepolia faucet.")
            faucet_tx_hash = await account.request_faucet(network=NETWORK, token="eth")
            w3.eth.wait_for_transaction_receipt(faucet_tx_hash, timeout=120)
            result = await account.send_transaction(transaction=transaction, network=NETWORK)

        tx_hash = result.transaction_hash if hasattr(result, "transaction_hash") else str(result)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

        if receipt.get("status") == 0:
            logger.error(f"AuditAnchor.anchor() transaction reverted (tx: {tx_hash})")
            return None

        return {"tx_hash": tx_hash, "base_block_number": int(receipt["blockNumber"])}
    except Exception as exc:
        logger.error(f"Anchor transaction failed (non-fatal — off-chain chain is unaffected): {exc}")
        return None
    finally:
        await cdp.close()


async def _send_batch_anchor_tx_async(batch_index: int, merkle_root: str, batch_root_hash: str) -> Optional[dict]:
    """V2 (batch Merkle) counterpart to _send_anchor_tx_async() above —
    identical shape, just against the V2 contract/ABI and its 3-argument
    anchor(batchIndex, merkleRoot, batchRootHash). See that function's
    docstring for the non-fatal-failure and faucet-retry reasoning, both
    unchanged here."""
    from cdp import CdpClient
    from cdp.evm_transaction_types import TransactionRequestEIP1559

    w3 = _build_web3()
    contract = _build_contract_v2(w3)

    cdp = CdpClient()
    try:
        account = await cdp.evm.get_or_create_account(name=settings.audit_backend_wallet_name)
        sender = Web3.to_checksum_address(account.address)
        gas_price = w3.eth.gas_price

        tx = contract.functions.anchor(
            batch_index,
            _hash_hex_to_bytes32(merkle_root),
            _hash_hex_to_bytes32(batch_root_hash),
        ).build_transaction({
            "from": sender,
            "nonce": w3.eth.get_transaction_count(sender, "pending"),
            "gas": 100_000,
            "gasPrice": gas_price,
            "chainId": CHAIN_ID,
        })

        transaction = TransactionRequestEIP1559(
            to=tx["to"],
            data=tx.get("data") or "0x",
            value=tx.get("value", 0),
            gas=tx.get("gas"),
            nonce=tx.get("nonce"),
            maxFeePerGas=gas_price,
            maxPriorityFeePerGas=gas_price,
            chainId=CHAIN_ID,
        )

        try:
            result = await account.send_transaction(transaction=transaction, network=NETWORK)
        except Exception as exc:
            if not _is_insufficient_balance_error(exc):
                raise
            logger.info(f"Audit backend wallet {sender} has insufficient gas — requesting Base Sepolia faucet.")
            faucet_tx_hash = await account.request_faucet(network=NETWORK, token="eth")
            w3.eth.wait_for_transaction_receipt(faucet_tx_hash, timeout=120)
            result = await account.send_transaction(transaction=transaction, network=NETWORK)

        tx_hash = result.transaction_hash if hasattr(result, "transaction_hash") else str(result)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

        if receipt.get("status") == 0:
            logger.error(f"AuditAnchor.anchor() (V2) transaction reverted (tx: {tx_hash})")
            return None

        return {"tx_hash": tx_hash, "base_block_number": int(receipt["blockNumber"])}
    except Exception as exc:
        logger.error(f"Batch anchor transaction failed (non-fatal — off-chain chain is unaffected): {exc}")
        return None
    finally:
        await cdp.close()


def anchor_chain_tip(db: Session) -> Optional[AuditAnchorRecord]:
    """
    V1 (legacy per-row chain) anchoring — anchors the current LEGACY
    chain tip unconditionally (no batch/timer threshold check — that's
    maybe_anchor_chain_tip()'s job). Returns the new AuditAnchorRecord on
    success, or None if not configured, there's no legacy tip (either the
    chain never had any pre-cutover rows, or every pre-cutover row is
    already anchored), or the transaction failed.

    Naturally becomes a permanent no-op once the legacy tip has been
    anchored for the last time: get_legacy_chain_tip() never advances
    past the cutover (no row written after it ever has block_hash set),
    so there's nothing new for this function to ever anchor again — see
    docs/audit-merkle-migration.md. anchor_latest_batch() below is its
    ongoing (V2) replacement.

    Commits its own transaction (unlike log_action()/chain_entry(),
    which leave committing to the caller) — this is a standalone
    operation invoked from a background loop or an ad-hoc admin action,
    never nested inside another write's atomicity.
    """
    if not is_configured():
        logger.info("Audit anchoring is not configured (no contract address or CDP credentials) — skipped.")
        return None

    tip = get_legacy_chain_tip(db)
    if tip is None:
        logger.info("Audit chain is empty — nothing to anchor yet.")
        return None

    already_anchored = (
        db.query(AuditAnchorRecord)
        .filter(AuditAnchorRecord.block_index_anchored == tip.block_index)
        .first()
    )
    if already_anchored is not None:
        logger.info(f"Chain tip (block_index={tip.block_index}) is already anchored — nothing to do.")
        return None

    result = _run(_send_anchor_tx_async(tip.block_index, tip.block_hash))
    if result is None:
        return None

    record = AuditAnchorRecord(
        block_index_anchored=tip.block_index,
        chain_tip_hash=tip.block_hash,
        tx_hash=result["tx_hash"],
        base_block_number=result["base_block_number"],
        anchored_at=datetime.now(timezone.utc),
    )
    db.add(record)
    db.commit()
    logger.info(f"✅ Anchored chain tip block_index={tip.block_index} on Base Sepolia (tx: {result['tx_hash']})")
    return record


def maybe_anchor_chain_tip(db: Session) -> Optional[AuditAnchorRecord]:
    """
    The actual batch/timer trigger: anchors only if ANCHOR_EVERY_N_BLOCKS
    unanchored rows have accumulated, or ANCHOR_EVERY_SECONDS has passed
    since the last anchor — whichever comes first. Called from the
    periodic background loop (run_periodic_anchor_check()); also safe to
    call directly (e.g. an admin "anchor now" action would just call
    anchor_chain_tip() instead, bypassing the threshold).
    """
    if not is_configured():
        return None

    tip = get_legacy_chain_tip(db)
    if tip is None:
        return None

    # V1-only: AuditAnchorRecord is a mixed table as of the batch Merkle
    # cutover (see docs/audit-merkle-migration.md) — a plain "most recent
    # by anchored_at" query could return a V2 (batch) row here, whose
    # block_index_anchored is NULL, and this function's whole threshold
    # calculation below is only meaningful against V1's per-row
    # block_index anchoring in the first place.
    last_anchor = (
        db.query(AuditAnchorRecord)
        .filter(AuditAnchorRecord.block_index_anchored.isnot(None))
        .order_by(AuditAnchorRecord.anchored_at.desc())
        .first()
    )

    if last_anchor is None:
        # Never anchored — anchor as soon as there's anything to anchor,
        # don't wait for the first threshold to be hit.
        return anchor_chain_tip(db)

    unanchored_count = tip.block_index - last_anchor.block_index_anchored
    if unanchored_count <= 0:
        return None  # already caught up

    seconds_since_last = (datetime.now(timezone.utc) - last_anchor.anchored_at).total_seconds()
    if unanchored_count >= ANCHOR_EVERY_N_BLOCKS or seconds_since_last >= ANCHOR_EVERY_SECONDS:
        return anchor_chain_tip(db)

    return None


def anchor_latest_batch(db: Session) -> Optional[AuditAnchorRecord]:
    """
    V2 (batch Merkle) anchoring — anchors the latest SEALED
    AuditLogBatch, unconditionally, if it isn't already anchored. Returns
    the new AuditAnchorRecord on success, or None if not configured
    (is_configured_v2()), no batch has been sealed yet, the latest
    sealed batch is already anchored, or the transaction failed.

    No separate batch/timer threshold check here, unlike V1's
    maybe_anchor_chain_tip() — deliberately: docs/audit-merkle-
    migration.md's Part 1.1 aligns batch boundaries 1:1 with anchor
    events specifically so the throttling only has to happen once, at
    the sealing layer (seal_batch()/maybe_seal_open_batch() already only
    seal a batch every MAX_BATCH_SIZE rows or ANCHOR_EVERY_SECONDS,
    whichever first). A second threshold here on top of that would be
    redundant — this function simply anchors whatever's newly sealed.
    maybe_anchor_latest_batch() below is the periodic-loop-safe wrapper
    (checks "is there anything new to anchor" cheaply before doing any
    work), the direct equivalent of anchor_chain_tip() vs
    maybe_anchor_chain_tip()'s own split.

    Commits its own transaction — same standalone-operation reasoning as
    anchor_chain_tip().
    """
    if not is_configured_v2():
        logger.info("V2 (batch Merkle) audit anchoring is not configured — skipped.")
        return None

    # is_backfilled excluded — a backfilled batch (see
    # AuditLogBatch.is_backfilled's docstring) must never be anchored
    # on-chain; per docs/audit-merkle-migration.md Part 5.6 backfill
    # exists purely for offline spot-checks. Matters specifically when
    # NO live batch has been sealed yet: without this filter, a
    # negative-indexed backfilled batch would otherwise be the only row
    # ORDER BY batch_index DESC finds.
    latest_batch = (
        db.query(AuditLogBatch)
        .filter(AuditLogBatch.is_backfilled.is_(False))
        .order_by(AuditLogBatch.batch_index.desc())
        .first()
    )
    if latest_batch is None:
        logger.info("No sealed audit log batch yet — nothing to anchor.")
        return None

    already_anchored = (
        db.query(AuditAnchorRecord)
        .filter(AuditAnchorRecord.batch_index_anchored == latest_batch.batch_index)
        .first()
    )
    if already_anchored is not None:
        logger.info(f"Batch {latest_batch.batch_index} is already anchored — nothing to do.")
        return None

    result = _run(_send_batch_anchor_tx_async(
        latest_batch.batch_index, latest_batch.merkle_root, latest_batch.batch_root_hash
    ))
    if result is None:
        return None

    record = AuditAnchorRecord(
        batch_index_anchored=latest_batch.batch_index,
        merkle_root=latest_batch.merkle_root,
        batch_root_hash=latest_batch.batch_root_hash,
        tx_hash=result["tx_hash"],
        base_block_number=result["base_block_number"],
        anchored_at=datetime.now(timezone.utc),
    )
    db.add(record)
    db.commit()
    logger.info(f"✅ Anchored batch {latest_batch.batch_index} on Base Sepolia (tx: {result['tx_hash']})")
    return record


def maybe_anchor_latest_batch(db: Session) -> Optional[AuditAnchorRecord]:
    """Periodic-loop-safe wrapper around anchor_latest_batch() — cheap
    early-out ("is there a sealed, not-yet-anchored batch at all") before
    anchor_latest_batch() re-does the same already-anchored check more
    expensively (a real _run()/is_configured_v2() call). Purely a cost
    optimization for the hot polling path; anchor_latest_batch() alone
    is already correct to call directly (e.g. an admin "anchor now"
    action)."""
    if not is_configured_v2():
        return None

    # is_backfilled excluded — a backfilled batch (see
    # AuditLogBatch.is_backfilled's docstring) must never be anchored
    # on-chain; per docs/audit-merkle-migration.md Part 5.6 backfill
    # exists purely for offline spot-checks. Matters specifically when
    # NO live batch has been sealed yet: without this filter, a
    # negative-indexed backfilled batch would otherwise be the only row
    # ORDER BY batch_index DESC finds.
    latest_batch = (
        db.query(AuditLogBatch)
        .filter(AuditLogBatch.is_backfilled.is_(False))
        .order_by(AuditLogBatch.batch_index.desc())
        .first()
    )
    if latest_batch is None:
        return None

    already_anchored = (
        db.query(AuditAnchorRecord)
        .filter(AuditAnchorRecord.batch_index_anchored == latest_batch.batch_index)
        .first()
    )
    if already_anchored is not None:
        return None

    return anchor_latest_batch(db)


# Public Base Sepolia RPC endpoints reject an eth_getLogs range this
# wide as "413 Payload Too Large" (verified against a live anchor, not
# assumed) — a window this size around a known block is always enough
# for our case (one Anchored event per anchor_chain_tip() call, and we
# already know almost exactly which block it landed in whenever we have
# that hint) without needing a dedicated/paid RPC provider.
_LOG_SEARCH_WINDOW_BLOCKS = 200


def fetch_anchor_event(block_index: int, near_block_number: Optional[int] = None) -> Optional[dict]:
    """
    V1 (legacy) — reads the on-chain Anchored event for a given
    block_index directly from Base Sepolia (eth_getLogs, filtered on the
    indexed blockIndex topic) — the other half of GET /audit/verify's
    on-chain cross-check for a pre-cutover anchor.
    This is the check nobody with local DB access (including an admin)
    can defeat: it doesn't trust anything this platform's own database
    says, only what's actually on-chain. Returns None if not configured,
    the RPC call fails, or no matching event is found.

    near_block_number: pass AuditAnchorRecord.base_block_number when the
    caller has it (verify_on_chain_anchor() always does) — narrows the
    eth_getLogs range to a small window around that block instead of
    searching from genesis, which free/public RPC endpoints reject
    outright for a chain with millions of blocks. Without a hint, this
    falls back to the most recent _LOG_SEARCH_WINDOW_BLOCKS blocks —
    fine for anchors made recently, but won't find an old one; always
    pass the hint when it's available.
    """
    if not is_configured():
        return None
    try:
        w3 = _build_web3()
        contract = _build_contract(w3)

        # to_block is always "latest", never a computed upper bound: an
        # anchor made moments ago can have near_block_number sitting
        # right at (or, if the RPC node's own head lags slightly, just
        # past) the chain's current head — near_block_number + window
        # would then ask for a range beyond what the node has, which
        # gets rejected outright rather than just returning fewer
        # results (verified live: "block range extends beyond current
        # head block"). Only from_block needs narrowing, to stay under
        # the RPC's max-range limit.
        if near_block_number is not None:
            from_block = max(0, near_block_number - _LOG_SEARCH_WINDOW_BLOCKS)
        else:
            latest = w3.eth.block_number
            from_block = max(0, latest - _LOG_SEARCH_WINDOW_BLOCKS)
        to_block = "latest"

        events = contract.events.Anchored.get_logs(
            argument_filters={"blockIndex": block_index},
            from_block=from_block,
            to_block=to_block,
        )
        if not events:
            return None
        event = events[-1]  # last match, in case of an extremely unlikely re-anchor of the same tip
        return {
            "block_index": event["args"]["blockIndex"],
            "chain_tip_hash": event["args"]["chainTipHash"].hex(),
            "timestamp": event["args"]["timestamp"],
            "tx_hash": event["transactionHash"].hex(),
            "base_block_number": event["blockNumber"],
        }
    except Exception as exc:
        logger.error(f"Could not fetch on-chain Anchored event for block_index={block_index}: {exc}")
        return None


def fetch_batch_anchor_event(batch_index: int, near_block_number: Optional[int] = None) -> Optional[dict]:
    """
    V2 — reads the on-chain Anchored event for a given batch_index
    directly from Base Sepolia (eth_getLogs, filtered on the indexed
    batchIndex topic). Same not-configured/RPC-failure/no-match ->
    None contract, same near_block_number narrowing reasoning, as
    fetch_anchor_event() above — see that function's docstring.
    """
    if not is_configured_v2():
        return None
    try:
        w3 = _build_web3()
        contract = _build_contract_v2(w3)

        if near_block_number is not None:
            from_block = max(0, near_block_number - _LOG_SEARCH_WINDOW_BLOCKS)
        else:
            latest = w3.eth.block_number
            from_block = max(0, latest - _LOG_SEARCH_WINDOW_BLOCKS)
        to_block = "latest"

        events = contract.events.Anchored.get_logs(
            argument_filters={"batchIndex": batch_index},
            from_block=from_block,
            to_block=to_block,
        )
        if not events:
            return None
        event = events[-1]  # last match, in case of an extremely unlikely re-anchor of the same batch
        return {
            "batch_index": event["args"]["batchIndex"],
            "merkle_root": event["args"]["merkleRoot"].hex(),
            "batch_root_hash": event["args"]["batchRootHash"].hex(),
            "timestamp": event["args"]["timestamp"],
            "tx_hash": event["transactionHash"].hex(),
            "base_block_number": event["blockNumber"],
        }
    except Exception as exc:
        logger.error(f"Could not fetch on-chain Anchored event for batch_index={batch_index}: {exc}")
        return None


def verify_on_chain_anchor(db: Session) -> dict:
    """
    The on-chain half of GET /audit/verify — see
    audit_service.verify_chain_integrity() for the local half. Finds the
    OVERALL most recent AuditAnchorRecord (either era — see
    docs/audit-merkle-migration.md), fetches its Anchored event straight
    from Base Sepolia (not from anything this platform stored about the
    anchor beyond the tx_hash needed to look it up), and compares the
    on-chain value(s) against what the LOCAL chain currently recomputes
    for that same block_index/batch_index — "currently", not "at anchor
    time": if a row before the anchored point were somehow altered, the
    local chain's own recompute wouldn't match what was anchored back
    when it was still correct, and this check would catch that too, not
    just a directly-edited anchored row.

    This is the check nobody with local DB access (including an admin)
    can defeat: it doesn't trust anything this platform's own database
    says the on-chain value is, only what fetch_anchor_event()/
    fetch_batch_anchor_event() reads directly from the chain.

    Dispatches to _verify_v1_anchor()/_verify_v2_anchor() based on which
    era the latest anchor record belongs to (batch_index_anchored set =
    V2, block_index_anchored set = V1 — see AuditAnchorRecord's own
    docstring for why exactly one is ever set per row). Once a V2
    contract is configured and anchoring, every NEW anchor is V2 (V1
    anchoring becomes a permanent no-op after the cutover — see
    anchor_chain_tip()'s docstring), so "most recent overall" naturally
    resolves to a V2 result once one exists, and to a V1 result before
    that (including for a deployment that never configures V2 at all).
    """
    if not (is_configured() or is_configured_v2()):
        return {"configured": False, "checked": False, "matches": None, "reason": "not configured"}

    latest_anchor = (
        db.query(AuditAnchorRecord)
        .order_by(AuditAnchorRecord.anchored_at.desc())
        .first()
    )
    if latest_anchor is None:
        return {"configured": True, "checked": False, "matches": None, "reason": "no anchor recorded yet"}

    if latest_anchor.batch_index_anchored is not None:
        return _verify_v2_anchor(db, latest_anchor)
    return _verify_v1_anchor(db, latest_anchor)


def _verify_v1_anchor(db: Session, latest_anchor: AuditAnchorRecord) -> dict:
    """The pre-cutover comparison — unchanged logic, just extracted out
    of verify_on_chain_anchor() so it can be dispatched to by era. See
    that function's own docstring for the full reasoning."""
    if not is_configured():
        return {
            "configured": False, "checked": False, "matches": None,
            "reason": "latest anchor is a V1 (legacy) anchor, but V1 is not configured here", "anchor_version": "v1",
        }

    # Recomputed from raw field values (ignores every stored hash column,
    # not just this row's) — NOT local_row.block_hash's stored value.
    # See recompute_block_hash_at()'s docstring for why: comparing
    # on-chain against a stored column an attacker could have rewritten
    # right alongside the fields it covers would only catch the naive
    # tamper (verify_chain_integrity() already does that); this is what
    # keeps a full-chain-rewrite tamper visible too.
    recomputed_hash = recompute_block_hash_at(db, latest_anchor.block_index_anchored)
    if recomputed_hash is None:
        # Should never happen — audit_logs has no delete path anywhere in
        # the API — surfaced explicitly rather than silently treated as
        # "matches" or crashing.
        return {
            "configured": True,
            "checked": False,
            "matches": None,
            "reason": "anchored block_index no longer exists in the local chain",
            "anchor_block_index": latest_anchor.block_index_anchored,
            "anchor_version": "v1",
        }

    on_chain_event = fetch_anchor_event(
        latest_anchor.block_index_anchored,
        near_block_number=latest_anchor.base_block_number,
    )
    if on_chain_event is None:
        return {
            "configured": True,
            "checked": False,
            "matches": None,
            "reason": "on-chain Anchored event not found (RPC issue, or the transaction hasn't confirmed yet)",
            "anchor_block_index": latest_anchor.block_index_anchored,
            "tx_hash": latest_anchor.tx_hash,
            "anchor_version": "v1",
        }

    matches = on_chain_event["chain_tip_hash"] == recomputed_hash
    return {
        "configured": True,
        "checked": True,
        "matches": matches,
        "anchor_block_index": latest_anchor.block_index_anchored,
        "local_block_hash": recomputed_hash,
        "on_chain_chain_tip_hash": on_chain_event["chain_tip_hash"],
        "tx_hash": latest_anchor.tx_hash,
        "base_block_number": latest_anchor.base_block_number,
        "anchored_at": latest_anchor.anchored_at,
        "anchor_version": "v1",
        "reason": None if matches else (
            "on-chain hash does not match the local chain's current hash for this block_index"
        ),
    }


def _verify_v2_anchor(db: Session, latest_anchor: AuditAnchorRecord) -> dict:
    """The post-cutover (batch Merkle) comparison — same three-step
    shape as _verify_v1_anchor(), just at the batch level: recompute
    locally from raw data_hash values (trusting no stored hash column,
    same principle as _verify_one_batch() in audit_service.py), fetch
    the on-chain event, compare BOTH merkleRoot and batchRootHash — see
    docs/audit-merkle-migration.md Part 2.2 for why both, not one."""
    if not is_configured_v2():
        return {
            "configured": False, "checked": False, "matches": None,
            "reason": "latest anchor is a V2 (batch) anchor, but V2 is not configured here", "anchor_version": "v2",
        }

    # Deferred imports: merkle_service/_verify_one_batch are only needed
    # on this (V2) path, and _verify_one_batch is audit_service.py's own
    # internal helper — imported here rather than at module top to avoid
    # a name that looks private crossing a module boundary implicitly.
    from app.services.audit import merkle_service
    from app.services.audit.audit_service import _verify_one_batch

    batch = (
        db.query(AuditLogBatch)
        .filter(AuditLogBatch.batch_index == latest_anchor.batch_index_anchored)
        .first()
    )
    if batch is None:
        # Should never happen — AuditLogBatch rows are never deleted —
        # surfaced explicitly rather than silently treated as "matches".
        return {
            "configured": True,
            "checked": False,
            "matches": None,
            "reason": "anchored batch_index no longer exists locally",
            "anchor_batch_index": latest_anchor.batch_index_anchored,
            "anchor_version": "v2",
        }

    local_result = _verify_one_batch(db, batch)
    if not local_result["intact"]:
        return {
            "configured": True,
            "checked": False,
            "matches": None,
            "reason": f"local batch recompute disagrees with what's stored for this batch: {local_result['reason']}",
            "anchor_batch_index": latest_anchor.batch_index_anchored,
            "anchor_version": "v2",
        }

    # batch_index == 0 always chains to GENESIS_PREV_HASH, full stop —
    # not looked up via batch_index - 1 (== -1) in that case, which could
    # otherwise accidentally match a BACKFILLED batch (negative
    # batch_index — see AuditLogBatch.is_backfilled's docstring): those
    # never chain into the live sequence, even coincidentally by index
    # arithmetic landing on one.
    if batch.batch_index == 0:
        prev_batch_root_hash = GENESIS_PREV_HASH
    else:
        prev_batch = (
            db.query(AuditLogBatch)
            .filter(AuditLogBatch.batch_index == batch.batch_index - 1, AuditLogBatch.is_backfilled.is_(False))
            .first()
        )
        prev_batch_root_hash = prev_batch.batch_root_hash if prev_batch is not None else GENESIS_PREV_HASH
    local_batch_root_hash = merkle_service.compute_batch_root_hash(
        batch_index=batch.batch_index,
        start_block_index=batch.start_block_index,
        end_block_index=batch.end_block_index,
        merkle_root_hex=local_result["merkle_root"],
        prev_batch_root_hash_hex=prev_batch_root_hash,
    )

    on_chain_event = fetch_batch_anchor_event(
        latest_anchor.batch_index_anchored,
        near_block_number=latest_anchor.base_block_number,
    )
    if on_chain_event is None:
        return {
            "configured": True,
            "checked": False,
            "matches": None,
            "reason": "on-chain Anchored event not found (RPC issue, or the transaction hasn't confirmed yet)",
            "anchor_batch_index": latest_anchor.batch_index_anchored,
            "tx_hash": latest_anchor.tx_hash,
            "anchor_version": "v2",
        }

    matches = (
        on_chain_event["merkle_root"] == local_result["merkle_root"]
        and on_chain_event["batch_root_hash"] == local_batch_root_hash
    )
    return {
        "configured": True,
        "checked": True,
        "matches": matches,
        "anchor_batch_index": latest_anchor.batch_index_anchored,
        "local_merkle_root": local_result["merkle_root"],
        "local_batch_root_hash": local_batch_root_hash,
        "on_chain_merkle_root": on_chain_event["merkle_root"],
        "on_chain_batch_root_hash": on_chain_event["batch_root_hash"],
        "tx_hash": latest_anchor.tx_hash,
        "base_block_number": latest_anchor.base_block_number,
        "anchored_at": latest_anchor.anchored_at,
        "anchor_version": "v2",
        "reason": None if matches else (
            "on-chain merkleRoot/batchRootHash does not match the local chain's current recompute for this batch"
        ),
    }


async def run_periodic_anchor_check(interval_seconds: int = 60) -> None:
    """
    Background loop — started from app/main.py's lifespan, cancelled on
    shutdown. Polls every `interval_seconds` and, in order:

      1. maybe_seal_open_batch() (audit_service.py) — the batch Merkle
         cutover's own sealing trigger (see docs/audit-merkle-
         migration.md Part 1.1a). Runs UNCONDITIONALLY, regardless of
         on-chain configuration — sealing is a purely local operation
         (it's what turns O(row_count) verification into O(batch_count)
         verification) and shouldn't depend on Base Sepolia being
         configured at all.
      2. maybe_anchor_chain_tip() — V1 (legacy). Naturally becomes a
         no-op forever once the legacy tip has been anchored for the
         last time (see that function's own docstring).
      3. maybe_anchor_latest_batch() — V2 (batch). Anchors whatever
         maybe_seal_open_batch() just sealed (or a previous tick sealed
         and this one hasn't caught up to yet).

    All three no-op cheaply when their respective prerequisite isn't
    configured/isn't due yet, so an unconfigured deployment (or one with
    only V1, or only V2, configured) just polls and does the applicable
    subset, cheaply.

    Runs each in a thread (asyncio.to_thread), not directly — _run()'s
    sync/async bridge (module docstring above) uses asyncio.run() as its
    fallback, which raises "cannot be called from a running event loop"
    when invoked from code that's already running inside one, exactly
    what this loop is. Verified live: the first time this loop actually
    found something to anchor, it hit that error and silently skipped
    the anchor attempt every tick thereafter. A thread has no running
    loop of its own, so _run()'s existing logic works unmodified once
    moved there — same fix already applied to
    graph_snapshot_service.run_periodic_graph_snapshot_refresh() for the
    identical reason.
    """
    from app.services.audit.audit_service import maybe_seal_open_batch
    from app.utils.db_connection import SessionLocal

    while True:
        try:
            db = SessionLocal()
            try:
                await asyncio.to_thread(maybe_seal_open_batch, db)
                await asyncio.to_thread(maybe_anchor_chain_tip, db)
                await asyncio.to_thread(maybe_anchor_latest_batch, db)
            finally:
                db.close()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"Periodic anchor check failed (non-fatal, retried next tick): {exc}")
        await asyncio.sleep(interval_seconds)
