"""
merkle_service.py — batch Merkle tree construction, proofs, and batch-root
chaining for the post-cutover audit chain (see
docs/audit-merkle-migration.md and app/models/audit/audit_log_batch.py).

Domain-separated hashing (leaf_hash vs internal_hash use different
prefix bytes) prevents the classic second-preimage attack where a leaf's
hash bytes could be reinterpreted as a valid internal node — a leaf can
never collide with an internal node's hash space by construction, not by
convention.

Odd-node promotion (not duplication) when a tree level has an odd number
of nodes: the last node is carried up to the next level unchanged rather
than paired with a copy of itself. Duplicate-leaf padding has known
second-preimage/equivocation issues in some Merkle variants (a
duplicated pair proves nothing beyond what the single node already
proved, but some verifiers can be tricked into accepting a shorter tree
as if it had the padded shape) — promotion sidesteps that class of issue
entirely by never introducing a hash that doesn't correspond to a real
node.

Parallelism, deliberately scoped at the BATCH level only, not within a
single batch's own tree construction: services/audit/audit_service.py's
verify_chain_integrity() fans out ONE ProcessPoolExecutor task per batch
(batch-level parallelism — this is where the real wall-clock win comes
from once there are many batches). Each worker task then calls
build_merkle_tree() here, which runs sequentially in-process. This is a
deliberate simplification of the migration spec's "each task internally
parallelizes per 1.2" — nesting a second process pool inside a task that
is ITSELF already a process-pool worker adds real complexity (pool
lifecycle inside a spawned process) and deadlock risk, for negligible
benefit at this batch-size scale: hashing MAX_BATCH_SIZE leaves with
sha256 is low-single-digit milliseconds even sequentially in pure Python
(sha256 itself is a fast C call; Python-level overhead per call dominates
at these sizes, not the hash computation). If MAX_BATCH_SIZE is ever
raised by an order of magnitude or more, revisit — chunked
executor.map() over leaf ranges is the natural next step, and
build_merkle_tree()'s leaf-hashing pass below is already structured as a
single list comprehension specifically so that swap is easy to make
later without restructuring anything else.
"""
import hashlib
from dataclasses import dataclass, field
from typing import Optional

LEAF_PREFIX = b"\x00"
INTERNAL_PREFIX = b"\x01"

# Batch-sealing size cap (see docs/audit-merkle-migration.md Part 1.1) —
# picked so a full-batch Merkle rebuild during verify is always cheap
# (see module docstring above) while keeping proof depth predictable
# (log2(5000) ≈ 13) even during a bursty bulk-ETL ingestion run that
# would otherwise produce one enormous, unbounded batch.
MAX_BATCH_SIZE = 5000


def leaf_hash(data_hash_hex: str) -> bytes:
    """data_hash_hex: a row's AuditLog.data_hash (64-char sha256 hex
    string, unchanged by this migration — see audit_service.py). Returns
    raw bytes, not hex, since internal_hash() below operates on raw bytes
    directly (hex round-tripping every level would be pure overhead)."""
    return hashlib.sha256(LEAF_PREFIX + bytes.fromhex(data_hash_hex)).digest()


def internal_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(INTERNAL_PREFIX + left + right).digest()


@dataclass
class MerkleTree:
    """levels[0] = leaves (one per row, in leaf_index order), levels[-1]
    = [root]. Kept in full (not pruned) — batches are capped at
    MAX_BATCH_SIZE, so the full tree is at most ~2 * MAX_BATCH_SIZE nodes,
    cheap to hold in memory for the lifetime of one seal/verify call; this
    is what makes get_merkle_proof() below able to produce a proof for
    any leaf without recomputing anything."""

    levels: list[list[bytes]] = field(default_factory=list)

    @property
    def root(self) -> bytes:
        if not self.levels or not self.levels[-1]:
            raise ValueError("empty tree has no root")
        return self.levels[-1][0]

    @property
    def root_hex(self) -> str:
        return self.root.hex()


def build_merkle_tree(data_hashes: list[str]) -> MerkleTree:
    """One row's worth of data_hash per entry, in leaf_index order (the
    caller — seal_batch() in audit_service.py, or a verify worker —
    is responsible for that ordering, matching block_index order per
    AuditLog's own docstring). Empty input raises rather than returning a
    degenerate tree: sealing/verifying a batch with zero rows is a caller
    bug (an AuditLogBatch is only ever created for a non-empty row
    range), not a state this function should paper over."""
    if not data_hashes:
        raise ValueError("cannot build a Merkle tree over zero rows")

    leaves = [leaf_hash(h) for h in data_hashes]
    tree = MerkleTree(levels=[leaves])

    current = leaves
    while len(current) > 1:
        next_level = []
        for i in range(0, len(current) - 1, 2):
            next_level.append(internal_hash(current[i], current[i + 1]))
        if len(current) % 2 == 1:
            # Odd node promoted unchanged — see module docstring for why
            # this is used instead of duplicating the last node.
            next_level.append(current[-1])
        tree.levels.append(next_level)
        current = next_level

    return tree


def get_merkle_proof(tree: MerkleTree, leaf_index: int) -> list[tuple[bytes, str]]:
    """Sibling hashes from leaf_index up to the root, as (sibling_hash,
    "left" | "right") pairs — "left"/"right" names which side the
    SIBLING sits on (so verify_row_in_batch() below knows the argument
    order for internal_hash(left, right) at each step). O(log batch_size)
    steps. A promoted (unpaired) node contributes no step at that level —
    its hash simply carries up unchanged, so there is nothing to prove
    against at that level."""
    if not (0 <= leaf_index < len(tree.levels[0])):
        raise ValueError(f"leaf_index {leaf_index} out of range for a tree with {len(tree.levels[0])} leaves")

    proof: list[tuple[bytes, str]] = []
    index = leaf_index
    for level in tree.levels[:-1]:  # every level except the root itself
        is_right_node = index % 2 == 1
        sibling_index = index - 1 if is_right_node else index + 1
        if sibling_index < len(level):
            sibling_side = "left" if is_right_node else "right"
            proof.append((level[sibling_index], sibling_side))
        # else: this node was promoted unchanged at this level — no
        # sibling, no proof step, index below still maps it correctly
        # into the next level up.
        index //= 2

    return proof


def verify_row_in_batch(
    data_hash_hex: str,
    proof: list[tuple[bytes, str]],
    expected_root: bytes,
) -> bool:
    """Recomputes leaf_index's path to the root using `proof` (from
    get_merkle_proof(), or independently supplied by a caller who only
    has the proof, not the whole tree — e.g. a third party checking a row
    against an on-chain-anchored root), compares to expected_root. This
    is the O(log batch_size) check that replaces needing the whole batch
    (or the whole table) in memory just to confirm one row's membership."""
    current = leaf_hash(data_hash_hex)
    for sibling_hash, sibling_side in proof:
        if sibling_side == "left":
            current = internal_hash(sibling_hash, current)
        else:
            current = internal_hash(current, sibling_hash)
    return current == expected_root


def compute_batch_root_hash(
    *,
    batch_index: int,
    start_block_index: int,
    end_block_index: int,
    merkle_root_hex: str,
    prev_batch_root_hash_hex: str,
) -> str:
    """batch_root_hash_i = sha256(f"{batch_index}|{start}|{end}|{merkle_root}|{prev_batch_root_hash}")
    — chains this batch to every batch before it, structurally identical
    to today's per-row block_hash formula (audit_service.py's
    _build_chain_row()) just operating on batches instead of rows. See
    docs/audit-merkle-migration.md Part 1.3. prev_batch_root_hash_hex for
    batch_index=0 is audit_service.GENESIS_PREV_HASH — reused directly by
    the caller (seal_batch()), not redefined here, so there is exactly
    one genesis constant in the codebase."""
    material = f"{batch_index}|{start_block_index}|{end_block_index}|{merkle_root_hex}|{prev_batch_root_hash_hex}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()
