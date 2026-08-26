# Immutable Audit Trail — How It Works

How every action and every ingested record in this platform gets
tamper-evidently chained, how that chain is verified, and how it's
anchored on-chain (Base Sepolia). This is the current-state explanation;
for the reasoning behind the design (why it changed from a per-row chain
to a batch Merkle tree), see `backend/docs/audit-merkle-migration.md`.

Code lives in `backend/app/services/audit/` (`audit_service.py`,
`anchor_service.py`, `merkle_service.py`), `backend/app/models/audit/`,
and `backend/app/routes/audit/audit.py`.

---

## 1. The two eras

The audit trail has **two chaining schemes**, back to back in the same
table (`audit_logs`), split at a cutover point:

- **Legacy (pre-cutover)**: every row hash-chained individually to the
  one before it. `O(n)` to verify — fine at small scale, became a
  multi-GB-memory, multi-minute problem once the table reached ~2M rows.
- **Batch Merkle (current, post-cutover)**: rows are grouped into
  capped-size batches; each batch gets ONE Merkle root, and batches chain
  to each other instead of individual rows chaining to each other.
  `O(batch_count)` to verify, and any single row's presence in a batch
  can be proven in `O(log batch_size)` via a Merkle proof.

Every row still has `data_hash` — the one thing that never changed. What
changed is how rows get linked together and rolled up.

You can tell which era a row belongs to just by looking at it:

| Column | Legacy row | Batch-era row |
|---|---|---|
| `data_hash` | set | set |
| `block_hash` / `prev_block_hash` | set | `NULL` |
| `batch_index` / `leaf_index` | `NULL` | set |

There's no config flag for this — it's implicit in the code. Every row
written today goes through the batch-era path; the legacy path only ever
reads rows that already exist from before the cutover.

---

## 2. The one thing that never changes: `data_hash`

Every row — either era — commits to its own content via:

```python
payload = {
    "actor_user_id": ..., "external_actor": ..., "action": ...,
    "target_type": ..., "target_id": ...,
    "before": before_value, "after": after_value,
    "event_timestamp": iso8601_utc_string,
}
data_hash = sha256(canonical_json(payload))
```

`canonical_json` = `json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)`
— sorted keys, no whitespace, so the same logical payload always hashes
identically regardless of dict insertion order or Python type quirks.

This is the value a Merkle leaf commits to in the batch era, and the
value the legacy `block_hash` formula folds in. Order-independent by
design — it says nothing about *where* this row sits in the chain, only
*what* it contains.

(`backend/app/services/audit/audit_service.py` — `_canonical_json()`,
`_sha256_hex()`, `_hashable_timestamp()`)

---

## 3. Legacy per-row chain (pre-cutover, read-only now)

```
row 0:  prev_hash = "000...0"  (genesis, 64 zero chars — GENESIS_PREV_HASH)
        block_hash₀ = sha256(f"0|{ts₀}|{data_hash₀}|000...0")

row 1:  prev_hash = block_hash₀
        block_hash₁ = sha256(f"1|{ts₁}|{data_hash₁}|{block_hash₀}")

row 2:  prev_hash = block_hash₁
        block_hash₂ = sha256(f"2|{ts₂}|{data_hash₂}|{block_hash₁}")
        ...
```

Each row's `block_hash` folds in the previous row's `block_hash` — a
classic hash chain. Tampering any row invalidates its own `block_hash`
and cascades forward through every later row's `prev_block_hash`.

**Verification** (`_verify_legacy_chain()` in `audit_service.py`) walks
every row with `block_hash IS NOT NULL`, from `block_index = 0` forward,
recomputing `data_hash` and `block_hash` fresh from raw field values and
comparing against what's stored. Streamed via a Postgres server-side
cursor (`stream_results=True` + `yield_per()`), not loaded into memory
all at once — this is what stops it OOM-killing the process at real row
counts. Its cost is now a **fixed, bounded constant**: this prefix never
grows (nothing new is ever written into it), so however long it takes
today is however long it will ever take.

---

## 4. Batch Merkle chain (current, every new write)

### 4.1 Merkle tree per batch

```
leaf_hash(data_hash)        = sha256(0x00 || data_hash)
internal_hash(left, right)  = sha256(0x01 || left || right)
```

Domain-separated on purpose: a leaf's hash bytes can never be mistaken
for an internal node's, closing the classic Merkle second-preimage
ambiguity. Leaves are `leaf_hash(row.data_hash)` for every row in the
batch, in `leaf_index` order (which mirrors `block_index` order). Odd
node at any level? It's promoted unchanged to the next level, never
duplicated — duplication has its own known equivocation issues in some
Merkle variants.

```
        root
       /    \
      H01    H23
     /  \    /  \
   L0   L1  L2   L3      <- leaf_hash(data_hash) for rows 0..3
```

(`backend/app/services/audit/merkle_service.py` — `build_merkle_tree()`,
`get_merkle_proof()`, `verify_row_in_batch()`)

### 4.2 Batches chain to each other

```
batch_root_hash_i = sha256(f"{batch_index}|{start_block_index}|{end_block_index}|{merkle_root}|{prev_batch_root_hash}")
```

Structurally the same idea as the legacy per-row chain, just one level
up: each batch's `batch_root_hash` folds in the previous batch's
`batch_root_hash`. `prev_batch_root_hash` for batch 0 is the same
genesis sentinel (`"0" * 64`) the legacy chain used.

```
batch 0                    batch 1                    batch 2
merkle_root₀                merkle_root₁                merkle_root₂
prev = genesis              prev = batch_root_hash₀     prev = batch_root_hash₁
batch_root_hash₀ ────────►  batch_root_hash₁ ────────►  batch_root_hash₂
```

Tampering any row inside batch 0 invalidates: that row's leaf → batch
0's `merkle_root` → batch 0's `batch_root_hash` → every later batch's
`batch_root_hash`. Same cascade property as the legacy chain, just far
fewer sequential links to walk to detect it.

### 4.3 How a batch gets sealed

Batches are capped at **5,000 rows** (`merkle_service.MAX_BATCH_SIZE`).
A batch is sealed — its Merkle tree built, its `AuditLogBatch` row
written — when either:

- it reaches the 5,000-row cap, **or**
- it's been open ≥ 5 minutes (same `ANCHOR_EVERY_SECONDS` threshold the
  on-chain anchor trigger already used)

whichever comes first. Sealing happens two ways:

- **Inline**, mid-write: `ChainWriter` (the bulk ETL writer) seals a
  batch the instant it hits the row cap, then keeps writing into the
  next one — this is the path that matters most in practice, since a
  single ETL run can write tens of thousands of rows in one go.
- **Periodically**: the background loop (`run_periodic_anchor_check()`
  in `anchor_service.py`) calls `maybe_seal_open_batch()` every 60s, for
  a batch that's been open a while without filling up (e.g. a quiet
  period with only occasional single in-platform actions).

Until a batch is sealed, its rows exist (with `data_hash`,
`batch_index`, `leaf_index` set) but aren't yet checkable against
anything stored — `verify_chain_integrity()` reports them as
`pending_rows`, not broken, not yet counted.

(`backend/app/services/audit/audit_service.py` — `seal_batch()`,
`maybe_seal_open_batch()`, `ChainWriter`, `_get_batch_write_state()`)

---

## 5. Writing a row

Two entry points, same underlying logic:

- **`log_action()` / `chain_entry()`** — one row at a time. Looks up
  current state fresh on every call (safe under concurrent writers —
  the global `block_index` tip is locked on Postgres). Used for
  in-platform actions: anomaly resolution, e-billing sync/retry, user
  administration, login attempts.
- **`ChainWriter`** — bulk writer for `scripts/etl_pipeline.py`'s
  ingestion path (every dispatch/invoice/payment/attendance/
  authorization/disbursement row). Fetches state ONCE, advances
  `block_index`/`batch_index`/`leaf_index` in memory per row instead of
  re-querying per row — this is the dominant source of row volume, so
  it's also where the batch cap is actually exercised in practice.

Both compute `data_hash` and assign `(batch_index, leaf_index)` to the
currently-open batch. Neither computes a per-row hash at write time
anymore — that only happens when the batch is sealed, over every row in
it together.

---

## 6. Verifying the whole chain

`GET /api/audit/verify` (`routes/audit/audit.py`) runs two independent
checks and reports both separately, on purpose — collapsing them into
one boolean would hide *which* guarantee is actually doing the work.

### 6.1 `local_chain` — `verify_chain_integrity()`

```
verify_chain_integrity()
 ├── _verify_legacy_chain()   (pre-cutover prefix, O(1) going forward)
 └── _verify_batch_era()      (every batch since, O(batch_count))
       └── per batch: _verify_one_batch()
             - recompute data_hash for every row in the batch FROM RAW FIELDS
               (not from the stored data_hash column — a tamper that edits a
               row's payload but leaves data_hash untouched must still be caught)
             - rebuild the Merkle tree from those recomputed hashes
             - compare the recomputed root to the batch's stored merkle_root
             - recompute batch_root_hash, compare to what's stored
             - check prev_batch_root_hash links to the actual previous batch
```

Both intact → overall intact. A failure reports exactly which row
(`broken_at_block_index`) inside exactly which batch
(`broken_at_batch_index`) — walking batches in order and reporting the
FIRST break, since everything downstream of a real tamper is just
cascade fallout, not a separate problem.

### 6.2 `on_chain_anchor` — `verify_on_chain_anchor()`

The check nobody with local database access — including an admin — can
defeat, because it doesn't trust anything this platform's own database
says the on-chain value is; it reads the comparison value straight from
Base Sepolia.

1. Find the most recent anchor record (either era).
2. Recompute the local value fresh from raw data (not from any stored
   hash column) — `recompute_block_hash_at()` for a legacy anchor,
   `_verify_one_batch()` + `compute_batch_root_hash()` for a batch
   anchor.
3. Fetch the actual on-chain event via `eth_getLogs` and compare.

See §7 for what's actually being anchored and compared.

---

## 7. On-chain anchoring

### 7.1 Two contract versions

| | V1 (legacy) | V2 (current) |
|---|---|---|
| Anchors | one row's `block_hash` (the chain tip) | one batch's `merkle_root` + `batch_root_hash` |
| Function | `anchor(blockIndex, chainTipHash)` | `anchor(batchIndex, merkleRoot, batchRootHash)` |
| Contract address | `AUDIT_ANCHOR_CONTRACT_ADDRESS` | `AUDIT_ANCHOR_CONTRACT_ADDRESS_V2` |
| ABI | `app/abi/AuditAnchorV1.json` | `app/abi/AuditAnchor.json` |
| Status | closed, historical — no new anchors, ever | active going forward |

Both can be configured at once. `verify_on_chain_anchor()` looks at the
most recent anchor record overall and reads it back from whichever
contract/ABI matches its era — see `anchor_service._verify_v1_anchor()`
/ `_verify_v2_anchor()`.

### 7.2 What actually happens

```
maybe_seal_open_batch()  (off-chain, always runs)
        │
        ▼
  AuditLogBatch row exists (merkle_root, batch_root_hash)
        │
        ▼
maybe_anchor_latest_batch()  (on-chain, only if V2 configured)
        │
        ▼
  CDP server wallet signs & broadcasts anchor(batchIndex, merkleRoot, batchRootHash)
        │
        ▼
  AuditAnchor.sol emits Anchored(batchIndex, merkleRoot, batchRootHash, timestamp)
        │
        ▼
  AuditAnchorRecord row saved locally (tx_hash, base_block_number — just a pointer to find it again)
```

No private key is ever held by this backend process — the CDP server
wallet signs server-side in a TEE. The contract only ever stores/emits
hashes; no beneficiary, OMC, or financial data touches it.

Both the sealing trigger and the (now-retired) anchor trigger reuse the
same threshold shape (`ANCHOR_EVERY_N_BLOCKS` / `ANCHOR_EVERY_SECONDS`,
whichever first) — see `backend/app/services/audit/anchor_service.py`.

---

## 8. Where each piece lives

| Concern | File |
|---|---|
| Row model, era columns | `backend/app/models/audit/audit.py` |
| Sealed batch model | `backend/app/models/audit/audit_log_batch.py` |
| On-chain anchor record | `backend/app/models/audit/audit_anchor.py` |
| Writing rows, sealing batches, legacy+batch verification | `backend/app/services/audit/audit_service.py` |
| Merkle tree / proof primitives | `backend/app/services/audit/merkle_service.py` |
| On-chain anchor read/write, V1/V2 dispatch | `backend/app/services/audit/anchor_service.py` |
| `GET /api/audit/verify` and friends | `backend/app/routes/audit/audit.py` |
| Response shapes | `backend/app/schemas/audit/audit.py` |
| Smart contract | `web3/contracts/AuditAnchor.sol` |
| Deploy script | `web3/scripts/deploy_audit_anchor.ts` |
| Design rationale, migration/cutover plan | `backend/docs/audit-merkle-migration.md` |
| One-time historical backfill (optional, offline) | `backend/scripts/backfill_audit_batches.py` |

---

## 9. Quick answers

**"Is my data safe if someone edits the database directly?"** No edit
survives `verify_chain_integrity()` undetected — it recomputes
everything from raw fields, trusting no stored hash column, including
the specific row that was edited.

**"What if someone edits the database AND recomputes every hash forward
to make it self-consistent again?"** `verify_chain_integrity()` alone
would be fooled (the stored chain really would look internally
consistent). `verify_on_chain_anchor()` would not — it compares against
what's permanently on Base Sepolia, which nobody with database access
can rewrite.

**"How fast is verification?"** `O(batch_count)`, not `O(row_count)`,
for everything written since the cutover — a batch is at most 5,000
rows, so growth in row count no longer means proportional growth in
verification time. The (fixed, non-growing) legacy prefix adds a
constant, one-time cost on top.

**"Can I prove a single row belongs to the chain without re-verifying
everything?"** Yes — `merkle_service.get_merkle_proof()` +
`verify_row_in_batch()` gives an `O(log batch_size)` proof for any row
in a sealed batch, independent of total row count or batch count.
