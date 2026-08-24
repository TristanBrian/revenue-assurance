# Audit Log: Linear Chain → Merkle Tree Migration Spec

> Revision note: this is a corrected pass over an earlier draft of this
> spec. The core design (batch-aligned Merkle trees, domain-separated
> hashing, batch-root chaining) is unchanged and sound. What changed:
> Part 3 (redeployment) was rewritten to match how this repo actually
> deploys contracts — the earlier draft described a factory/mock
> contract that was never built and never used; it also warned about a
> `msg.sender`-in-constructor bug that doesn't exist in the current
> contract. A handful of gaps (schema nullability, the bulk ETL write
> path, real anchor batch sizes, anchor-record storage for two hashes)
> are now made explicit rather than implied. See the "Corrected"
> callouts throughout for exactly what changed and why, each pointing at
> the actual file/line it was checked against.

## Context

Current design: every row gets a `data_hash` (content commitment, order-independent)
and a `block_hash` (position commitment, folds in `prev_block_hash`), forming a strict
linear chain from genesis. `verify_chain_integrity()` walks this chain from row 0
forward, recomputing every hash sequentially — this is why it OOMs / blows up memory
at scale, and why it can't be parallelized (each `block_hash` structurally depends
on the one before it).

Verified directly against this deployment: `audit_logs` currently holds **~1.9M rows**
(not the ~35K a single ETL run's own log line reports — that number is per-run;
`audit_logs` is append-only and accumulates across every ETL run this environment has
had). `verify_chain_integrity()`'s `db.query(AuditLog).order_by(...).all()`
materializing all of them as ORM objects at once got the whole `uvicorn` process
OOM-killed by the kernel — confirmed via `dmesg`, RSS over 5GB before the kill. That
crash is already fixed independently of this migration (see
`app/services/audit/audit_service.py`'s `verify_chain_integrity()` /
`recompute_block_hash_at()`, which now stream via a server-side cursor —
`execution_options(stream_results=True)` + `yield_per()`). This migration is about the
**wall-clock cost** of a full sequential walk at that row count, and about giving you
`O(log n)` single-row proofs — not about stopping a crash that's already stopped.

Goal: replace the per-row linear chain with **batch-aligned Merkle trees**, chained at
the batch-root level, so that:

- Full verification is parallelizable (hashing within/across batches has no sequential
  dependency).
- Single-row proofs are `O(log batch_size)` instead of `O(n)`.
- The tamper-evident *ordering* guarantee the chain gives you today is preserved via a
  much shorter chain of batch roots.
- The on-chain anchor still anchors a single event per anchor call, same as today —
  just anchoring a batch's Merkle root (plus the batch-root chain hash) instead of a
  per-row chain tip.

`data_hash` is unchanged — it is already a correct, position-independent content
commitment and does not need to change.

---

## Part 1 — Internal hashing: batch Merkle trees

### 1.1 Batch boundaries

**Corrected — batch size is not a fixed 50.** Reuse the existing anchor trigger
(`app/services/audit/anchor_service.py`'s `maybe_anchor_chain_tip()`, constants
`ANCHOR_EVERY_N_BLOCKS = 50` / `ANCHOR_EVERY_SECONDS = 5 * 60`, confirmed accurate
against the current code) as the batch-sealing trigger — same "≥50 new rows OR 5
minutes elapsed, whichever first" rule, just sealing a batch instead of anchoring a
single tip hash. But note what that trigger actually produces: `unanchored_count =
tip.block_index - last_anchor.block_index_anchored` is *however many rows accumulated
since the last anchor*, not a capped 50. The dominant write path
(`ChainWriter`, see 1.1a below) writes in bulk during ETL runs — one run in this
environment chained ~35K rows in a single script execution, all between two anchor-loop
polls. **A real batch can be tens of thousands of rows, not ~50.** Design for that:

- If a bounded proof size matters to you, cap batch size explicitly (e.g. seal
  multiple 5K-row batches back-to-back when a burst is behind, rather than one giant
  batch) — a decision to make deliberately, not an accident of trigger timing.
- If it doesn't, accept variable batch sizes: proofs are still `O(log batch_size)`,
  which for a 35K-row batch is depth ~16 instead of depth ~6 for a 50-row batch — both
  are enormously better than `O(n)` over the full 1.9M-row table, just don't advertise
  a specific small `n / 50` batch count, since it won't hold in practice.

This spec proceeds with the **explicit cap** option (default cap: 5,000 rows/batch —
picked as "small enough that a full-batch Merkle rebuild is always fast, large enough
that a 35K-row ETL burst seals in ~7 batches instead of 700"), since it keeps proof
depth predictable regardless of how bursty ingestion is. Adjust the constant if you'd
rather not cap.

Each batch has:

- `batch_index` (int, increments by 1)
- `start_block_index`, `end_block_index` (inclusive range of `AuditLog.block_index`
  covered — at most `MAX_BATCH_SIZE` rows apart)
- `merkle_root` (root of the Merkle tree over this batch's `data_hash` values)
- `batch_root_hash` (chains this batch to the previous one — see 1.3)
- `prev_batch_root_hash`
- `created_at`

Add a new table, `AuditLogBatch`, with these columns.

**Corrected — `AuditLog.block_hash`/`prev_block_hash` need an actual migration, not
just "stop writing them."** Both columns are `nullable=False` today
(`app/models/audit/audit.py:100-102`; `block_hash` is also `unique=True`). Existing
rows keep their values as-is (never touched, never backfilled with new semantics). Ship
an Alembic migration that relaxes both to nullable:

```python
def upgrade():
    op.alter_column("audit_logs", "block_hash", nullable=True)
    op.alter_column("audit_logs", "prev_block_hash", nullable=True)
```

(`block_hash`'s `unique=True` constraint is unaffected — Postgres allows multiple NULLs
under a unique constraint by default.) New rows (post-cutover) get `data_hash` plus
`batch_index` and `leaf_index` (their position within the batch, for proof generation)
— two new nullable columns on `AuditLog` (nullable because pre-cutover rows don't have
them):

```python
def upgrade():
    op.add_column("audit_logs", sa.Column("batch_index", sa.BigInteger(), nullable=True))
    op.add_column("audit_logs", sa.Column("leaf_index", sa.Integer(), nullable=True))
    op.create_index("ix_audit_logs_batch_index", "audit_logs", ["batch_index"])
```

### 1.1a The bulk ingestion write path must change too

**Corrected — this was unaddressed in the earlier draft.** `ChainWriter`
(`app/services/audit/audit_service.py`, currently ~line 289) is the *dominant* source
of row volume — it's what `scripts/etl_pipeline.py` uses for bulk ingestion (10k+
dispatches alone per run), fetching the chain tip once and advancing `block_index`/
`prev_block_hash` in memory per row, computing `block_hash` with the same formula
`_build_chain_row()` uses. This is precisely the path that produced the 1.9M rows this
migration exists to handle, so it's the most important write path to get right:

- **Post-cutover, `ChainWriter.write_ingested()` stops computing `block_hash`/
  `prev_block_hash` entirely.** It still assigns `block_index` sequentially (ordering
  within a batch still matters — leaves are ordered by `block_index`) and still
  computes `data_hash` (unchanged, per the Context section above). It additionally
  tracks which `batch_index`/`leaf_index` each row belongs to, filling a batch up to
  `MAX_BATCH_SIZE` rows before sealing it and starting the next.
- `chain_entry()` (the single-row write path, used for in-platform actions logged one
  at a time) changes the same way: computes `data_hash`, assigns `block_index` and
  `(batch_index, leaf_index)` against whatever batch is currently open, no
  `block_hash`/`prev_block_hash`.
- **A batch is sealed** (its `AuditLogBatch` row written, `merkle_root`/
  `batch_root_hash` computed per 1.2/1.3) when either it reaches `MAX_BATCH_SIZE` rows
  or the existing time trigger (`ANCHOR_EVERY_SECONDS`) fires — same batch-sealing
  logic runs from both `ChainWriter.finalize()` (end of an ETL run) and the periodic
  anchor-check loop (for a batch that's been open a while without filling up).

### 1.2 Merkle tree construction (per batch)

Use domain-separated hashing to prevent second-preimage attacks (a leaf must never be
reinterpretable as an internal node):

```
leaf_hash(data_hash)        = sha256(0x00 || data_hash)
internal_hash(left, right)  = sha256(0x01 || left || right)
```

- Leaves = `leaf_hash(row.data_hash)` for every row in the batch, in `block_index`
  (equivalently `leaf_index`) order.
- If a level has an odd number of nodes, promote the last node unchanged to the next
  level (do **not** duplicate it — duplication has known second-preimage issues in
  some Merkle variants; odd-node promotion avoids that).
- Root = single node at the top.

This step is **embarrassingly parallel**: every leaf hash is independent, and every
node at a given tree level is independent of its siblings. Use
`concurrent.futures.ProcessPoolExecutor` (not threads — `hashlib.sha256` releases the
GIL for the C call itself but you still want process-level parallelism to scale across
cores for large batches; benchmark both, but default to processes) to:

- Hash all leaves in parallel, chunked (e.g. 5–10k rows per worker task — moot for the
  default 5,000-row batch cap from 1.1, since a whole batch is already one chunk; this
  matters more if you choose not to cap batch size).
- Hash each tree level's pairs in parallel.

**Corrected — pool lifecycle.** Don't spin up a `ProcessPoolExecutor` per call. This
codebase already has a convention for long-lived background resources: `app/main.py`'s
lifespan starts the graph-snapshot refresh loop, the retrain-check loop, and the
periodic anchor-check loop once at startup and cancels them on shutdown (see
`app/services/fraud/graph_snapshot_service.run_periodic_graph_snapshot_refresh()` /
`app/services/fraud/fraud_scoring_service.run_periodic_retrain_check()` /
`app/services/audit/anchor_service.run_periodic_anchor_check()` for the pattern).
Create one process pool the same way — at lifespan startup, sized to `os.cpu_count()`
(or a configured cap), shut down cleanly on lifespan teardown — and reuse it for both
routine batch sealing and on-demand `/api/audit/verify` calls, rather than paying pool
startup cost on every call.

### 1.3 Chaining batch roots

```
batch_root_hash_i = sha256(
    f"{batch_index_i}|{start_block_index_i}|{end_block_index_i}|{merkle_root_i}|{prev_batch_root_hash_i}"
)
```

`prev_batch_root_hash_0` = the same genesis sentinel already used today
(`GENESIS_PREV_HASH = "0" * 64`, `app/services/audit/audit_service.py:44` — reuse the
existing constant, don't redefine it). This is structurally identical to the current
per-row chain, just operating at the batch level — so tampering with any row
invalidates that batch's `merkle_root`, which invalidates that batch's
`batch_root_hash`, which cascades forward through every later `batch_root_hash`,
exactly like today's row-level cascade. You lose nothing in tamper-evidence; you trade
`n` sequential steps for `n / batch_size` (variable per 1.1, but bounded by
`MAX_BATCH_SIZE` if you adopt the cap).

### 1.4 New/changed functions

- `build_batch_merkle_tree(rows: list[AuditLog]) -> MerkleTree` — parallel construction
  as above; returns root + the full tree (or at minimum enough intermediate nodes to
  produce proofs on demand).
- `get_merkle_proof(row, batch) -> list[bytes32]` — sibling hashes from the row's leaf
  to the batch root. `O(log batch_size)` for that batch.
- `verify_row_in_batch(data_hash, proof, leaf_index, expected_root) -> bool` —
  recompute leaf→root using the proof, compare to `expected_root`.
- `verify_chain_integrity()` — **rewritten**:
  1. Fan out: rebuild the Merkle tree for every batch **in parallel** (the shared
     process pool from 1.2, one task per batch, each task internally parallelizing per
     1.2 for very large batches). Compare each recomputed `merkle_root` to the stored
     one.
  2. Walk the (short) `batch_root_hash` chain sequentially — this is now
     `O(batch_count)`, not `O(rows)`, so it's cheap even single-threaded.
  3. Report per-batch results plus overall chain-of-roots integrity. **Additively**
     extend `LocalChainVerification` (`app/schemas/audit/audit.py:59-65`) rather than
     replacing its shape — existing fields (`intact`, `broken_at_block_index`,
     `chain_length`, `tip_block_index`, `tip_block_hash`) keep meaning what they mean
     today (row-level, computed from the batch results); add a new optional
     `batch_results: list[BatchVerification] | None` field carrying the per-batch
     detail, so this stays backward-compatible with anything already consuming
     `GET /api/audit/verify`.
- **Checkpointing — moved to an explicit Phase 2, not part of this migration's
  acceptance criteria.** `GET /api/audit/verify` is an on-demand admin action today,
  not a scheduled poll (confirmed: no route/background task calls it routinely). Once
  verification is `O(batch_count)` instead of `O(rows)`, a full walk over even a few
  hundred batches, in parallel, should be fast enough on its own at this data scale —
  add checkpointing later only if a real measurement shows it's still needed, not
  speculatively. If/when it is: cache the last successfully verified `batch_index`
  (small dedicated table or the existing `app/core/cache.py` in-memory pattern this
  codebase already uses elsewhere), and a routine call only re-verifies the cached
  checkpoint's own batch plus anything newer.

### 1.5 Streaming reads

**Already shipped, independent of this migration.** `verify_chain_integrity()` and
`recompute_block_hash_at()` in `app/services/audit/audit_service.py` now use a
server-side cursor (`execution_options(stream_results=True)` + `yield_per(5000)`)
instead of `db.query(...).all()` — this is what stopped the OOM. This migration's
batch reads (`WHERE block_index BETWEEN start AND end` per batch) should use the same
pattern for consistency, but memory was already bounded before this migration; the
Merkle change is purely a wall-clock/parallelism win on top of that.

---

## Part 2 — Smart contract redesign (`AuditAnchor.sol`)

### 2.1 Storage / anchor function

**Corrected — keep the existing minimalism and naming, don't introduce on-chain
storage or rename `backend`→`owner`.** The current contract
(`web3/contracts/AuditAnchor.sol`) is deliberately event-only — its own docstring
states: *"Stores nothing beyond `backend`... the Anchored event log **IS** the
permanent record."* `verify_on_chain_anchor()` already reads the comparison value via
`eth_getLogs`, never an on-chain getter — so a `mapping(uint256 => Anchor)` plus
`getAnchor()` would add real per-anchor `SSTORE` gas cost for a read path nothing
actually uses. Keep it event-only; just anchor two hashes instead of one, and keep
`backend`/`onlyBackend` naming to match the existing contract, deploy script comments,
and `anchor_service.py`'s own vocabulary (`AUDIT_BACKEND_WALLET_NAME`,
`get_backend_address()`):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title AuditAnchor
/// @notice On-chain anchor for the off-chain immutable audit trail
/// (backend/app/models/audit/audit.py's AuditLog + AuditLogBatch tables).
/// Stores nothing beyond `backend` — the Anchored event log IS the
/// permanent record. Only a batch's Merkle root and its batch-root chain
/// hash are ever written here; no beneficiary, OMC, or financial data
/// touches this contract or appears in any transaction/event it emits.
contract AuditAnchor {

    // Backend (trusted anchoring service — the CDP server wallet named
    // AUDIT_BACKEND_WALLET_NAME, see backend/app/services/audit/
    // anchor_service.py). Immutable: set once at deploy time to the CDP
    // account's own address via an explicit constructor argument — see
    // scripts/deploy_audit_anchor.ts's own comment for why this can't be
    // msg.sender (the deploy transaction's sender is a throwaway local
    // key, not the CDP wallet — see Part 3 below).
    address public immutable backend;

    // batchIndex is indexed so a specific anchor can be looked up
    // directly via eth_getLogs without scanning the whole event history
    // (see anchor_service.py's fetch_anchor_event()).
    event Anchored(
        uint256 indexed batchIndex,
        bytes32 merkleRoot,
        bytes32 batchRootHash,
        uint256 timestamp
    );

    modifier onlyBackend() {
        require(msg.sender == backend, "Only backend allowed");
        _;
    }

    constructor(address _backend) {
        backend = _backend;
    }

    /// @notice Anchors one sealed batch of the off-chain audit chain.
    /// @param batchIndex The AuditLogBatch.batch_index being anchored.
    /// @param merkleRoot Root of the Merkle tree over this batch's rows —
    /// lets a single row be proven present via a Merkle proof without
    /// trusting anything this platform's own database says.
    /// @param batchRootHash Commits this batch to every batch before it
    /// (folds in prev_batch_root_hash) — the ordering/chain-of-custody
    /// guarantee, equivalent to today's per-row chainTipHash but at the
    /// batch level.
    function anchor(
        uint256 batchIndex,
        bytes32 merkleRoot,
        bytes32 batchRootHash
    ) external onlyBackend {
        emit Anchored(batchIndex, merkleRoot, batchRootHash, block.timestamp);
    }
}
```

If you later want a third party to verify a single row against the chain without
trusting this platform's API at all, an on-chain `verifyProof(leaf, proof, root)` (e.g.
OpenZeppelin's `MerkleProof` library) is a legitimate follow-up — not required for the
`verify_on_chain_anchor()` off-chain comparison flow this spec covers, so left out of
the initial redeploy to keep gas cost down.

### 2.2 Model + `verify_on_chain_anchor()` changes

**Corrected — `AuditAnchorRecord` needs new columns; the spec's earlier draft didn't
address this.** Today's table (`app/models/audit/audit_anchor.py`) stores exactly one
hash, `chain_tip_hash`. Comparing two on-chain values (`merkleRoot` and
`batchRootHash`) means storing two locally too — same reason `chain_tip_hash` is
duplicated locally today (it's what `verify_on_chain_anchor()`'s local recompute is
compared against). Either:

- add `merkle_root` and `batch_root_hash` columns to `AuditAnchorRecord` (rename
  `block_index_anchored` → `batch_index_anchored` to match, keep `chain_tip_hash` only
  for pre-cutover anchors — nullable going forward), or
- introduce a separate `AuditLogBatchAnchor` table if you'd rather not overload one
  model for both eras — either is fine; pick whichever reads more clearly to you, but
  decide it explicitly rather than reusing `chain_tip_hash` for a value that's no
  longer a single per-row hash.

Same three-step shape as today (`verify_on_chain_anchor()`,
`app/services/audit/anchor_service.py:372`), adjusted for batches:

1. Find the latest anchor record locally → get `batch_index_anchored`.
2. Recompute `merkle_root` and `batch_root_hash` for that exact batch from raw
   `data_hash` values (Part 1.2/1.3) — ignore stored columns entirely, same
   "don't trust your own DB" principle as today's `recompute_block_hash_at()`.
3. `fetch_anchor_event(batch_index)` off Base Sepolia via `eth_getLogs` — same function,
   same `argument_filters={"blockIndex": ...}`-style pattern just filtered on
   `batchIndex` instead — compare both `merkleRoot` and `batchRootHash` against the
   recomputed values.

Step 2's per-batch recompute is cheap and parallel (Part 1.2), so this whole check gets
*faster* than today's version, not slower, despite doing strictly more comparison work
(two hashes instead of one).

---

## Part 3 — Redeployment

**Rewritten — the earlier draft's Part 3 described a mechanism this repo has never
used and does not have (a factory/mock contract that `CREATE`s the real contract via a
normal `to`-bearing transaction). That's not how `web3/scripts/deploy_audit_anchor.ts`
works, and its own header comment explains why at length — worth reading directly
before touching this script.** The actual, already-solved mechanism:

CDP server wallets' `sendTransaction()` rejects any transaction with an empty `to`
field (i.e. a raw contract-creation transaction) outright — verified directly against
this exact account/code path, not assumed, and there's no separate "deploy contract"
method on the CDP SDK to use instead. The workaround already in place: a **throwaway
local private key**, generated fresh every deploy run and never persisted, submits the
actual `CREATE` transaction — but the constructor argument passed is still the CDP
wallet's address, not the throwaway key's. Ethereum's `CREATE` semantics only care
about constructor args for what the contract's own state ends up holding;
`AuditAnchor.sol` sets `backend = _backend` from that argument, not from `msg.sender`
— so the deployed contract's authorization model ends up identical to what a
CDP-signed deploy would have produced, even though a different key paid the one-time
deploy gas. **This already works correctly today and needs no fix** — there is no
"constructor sets owner/backend to `msg.sender`" bug in the current contract to avoid
reintroducing.

Redeploy steps, reusing this exact pattern for the new bytecode/ABI:

1. **Update `web3/scripts/deploy_audit_anchor.ts` only where the contract's shape
   changed** — the ABI/bytecode path (still built by `npx hardhat compile` against the
   new `AuditAnchor.sol` from Part 2.1) and nothing else. The funding step (one
   CDP-signed transfer to the throwaway key, sized by `DEPLOY_GAS_FUNDING`), the
   `deployContract({ abi, bytecode, args: [backendAccount.address] })` call, and the
   post-deploy gas-sweep step are all unchanged — this contract is the same size class
   as today's, so the existing `DEPLOY_GAS_FUNDING` (`0.00005 ETH`) should still be
   comfortably enough; bump only if a real deploy attempt reports insufficient funds.
2. Deploy the new `AuditAnchor`, capture its printed address, and store it as a **new**
   config value (e.g. `AUDIT_ANCHOR_CONTRACT_ADDRESS_V2`) — not overwriting
   `AUDIT_ANCHOR_CONTRACT_ADDRESS` — so historical `verify_on_chain_anchor()` calls for
   pre-cutover batches can still resolve against the old contract if ever needed (Part
   5's cutover-aware verify path needs both addresses available: old contract for
   pre-cutover `block_index`-anchored rows, new contract for post-cutover
   `batch_index`-anchored ones).
3. Sanity-check post-deploy: call `backend()` on the new contract (matching the actual
   public variable name — **not** `owner()`, which doesn't exist on this contract) and
   confirm it returns the CDP wallet's own address (the same one
   `anchor_service.get_backend_address()` already resolves) before wiring up the
   batch-anchor loop, so a constructor-arg mistake fails loudly in staging rather than
   silently in prod.

---

## Part 4 — Parallel verification, end to end

- **CPU-bound hashing** (leaf/tree construction): the shared `ProcessPoolExecutor` from
  1.2/1.4 (started once at app startup, not per call), chunked by batch and, within
  very large batches, by leaf ranges. This is where most of the wall-clock win comes
  from.
- **I/O-bound work** (DB batch fetches, `eth_getLogs` calls): can run concurrently with
  CPU-bound recompute using `asyncio` or a thread pool — e.g. kick off the on-chain
  event fetch (Part 2.2 step 3) at the same time as the local batch recompute (step 2),
  then compare once both resolve, rather than doing them sequentially as today's
  `verify_on_chain_anchor()` does. Note `anchor_service.py`'s existing `_run()` sync/
  async bridge (`app/services/audit/anchor_service.py:94`) already exists for exactly
  this kind of "call async code from a sync route" need — extend that, don't build a
  parallel mechanism.
- **Full verification** (Part 1.4's rewritten `verify_chain_integrity()`) fans out
  across *all* batches in parallel and should scale close to linearly with core count
  once checkpointing (Phase 2, if it turns out to be needed) narrows routine calls to
  only the batches added since the last check.

---

## Part 5 — Migration / cutover

1. Pick a cutover `block_index` = the next block to be written (i.e., don't touch
   history).
2. Ship the schema changes:
   - `AuditLogBatch` table (Part 1.1).
   - `ALTER COLUMN block_hash/prev_block_hash DROP NOT NULL` on `audit_logs`, plus new
     nullable `batch_index`/`leaf_index` columns (Part 1.1, migration snippet above).
   - New `merkle_root`/`batch_root_hash` columns (or new table) on the anchor-record
     side (Part 2.2).
3. Ship the new write path: `ChainWriter.write_ingested()` and `chain_entry()` stop
   computing `block_hash`/`prev_block_hash` for new rows going forward, start assigning
   `batch_index`/`leaf_index` instead (Part 1.1a) — this is the change that actually
   matters most, since it's where nearly all row volume comes from.
4. Ship the new `anchor()` calls against the **new** contract from Part 3, going
   forward only — old contract stays reachable (its address kept, not overwritten) for
   resolving pre-cutover anchors.
5. `verify_chain_integrity()` becomes cutover-aware: rows before the cutover verify via
   the old sequential chain walk (kept as a legacy code path, only ever invoked for
   that fixed, non-growing range — so its cost is now a *bounded constant*, not an
   ever-growing liability, and it's already memory-safe per Part 1.5); rows at/after
   cutover verify via Part 1.4. `verify_on_chain_anchor()` similarly checks whichever
   contract address matches the era of the anchor record it's resolving.
6. Optional backfill: retroactively bucket the pre-cutover ~1.9M rows into
   `AuditLogBatch` entries (same batch cap, e.g. 5,000 rows) purely so historical data
   benefits from parallel/`O(log n)` verification too. This does **not** anchor
   anything new on-chain for the past (those anchor events already happened under the
   old contract); it just gives you the option to run fast Merkle-based spot checks
   against historical rows using their existing `data_hash` values. Treat this as a
   one-time offline script run against a copy of the data first, not part of the live
   write path, and not something to run inline from a request handler given the row
   count involved.

---

## Acceptance criteria

- [ ] Tampering with any single row's content invalidates that row's leaf, its batch's
      `merkle_root`, that batch's `batch_root_hash`, and every subsequent
      `batch_root_hash` — verified with a test that mutates one row and asserts the
      break is detected and correctly localized to that batch.
- [ ] `verify_chain_integrity()` on the full historical + new dataset completes without
      the prior memory blowup (already true today per Part 1.5) and materially faster
      than the current sequential walk on the post-cutover portion of the data.
- [ ] Single-row Merkle proof verification is `O(log batch_size)` in wall time relative
      to the batch it belongs to, independent of total row count in the table.
- [ ] `ChainWriter` and `chain_entry()` no longer write `block_hash`/`prev_block_hash`
      for any row created after the cutover `block_index`.
- [ ] New `AuditAnchor` contract deploys via the existing throwaway-key deploy pattern
      (Part 3, `deploy_audit_anchor.ts`), with `backend()` returning the CDP server
      wallet's address (not the throwaway deploy key's, and there is no `owner()` to
      confuse this with).
- [ ] `verify_on_chain_anchor()` for a batch anchored on the new contract independently
      confirms both `merkleRoot` and `batchRootHash` against `eth_getLogs`, without
      trusting any locally stored hash column.
- [ ] Full deep verification of the ~1.9M-row historical set (post-backfill, if run)
      completes meaningfully faster than the current sequential walk, scaling with
      available cores.
- [ ] `GET /api/audit/verify`'s response stays backward-compatible: existing
      `LocalChainVerification`/`OnChainAnchorVerification` fields keep their current
      meaning; new detail is additive.
