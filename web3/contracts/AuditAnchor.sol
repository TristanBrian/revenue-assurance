// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title AuditAnchor
/// @notice On-chain anchor for the off-chain immutable audit trail
/// (backend/app/models/audit/audit.py's AuditLog + AuditLogBatch tables —
/// see backend/docs/audit-merkle-migration.md). Stores nothing beyond
/// `backend` — the Anchored event log IS the permanent record. Only a
/// sealed batch's Merkle root and its batch-root chain hash are ever
/// written here; no beneficiary, OMC, or financial data touches this
/// contract or appears in any transaction/event it emits.
///
/// V2 of this contract: the original (see git history / app/abi/
/// AuditAnchorV1.json) anchored a single per-row chain-tip hash
/// (blockIndex/chainTipHash). This version anchors one sealed batch's
/// Merkle root + batch-root chain hash instead (batchIndex/merkleRoot/
/// batchRootHash) — see backend/app/services/audit/audit_service.py's
/// seal_batch(). Deployed at a NEW address, not upgraded in place; the
/// old contract's already-anchored events remain readable and are still
/// what backend/app/services/audit/anchor_service.py's legacy path
/// verifies pre-cutover anchors against.
contract AuditAnchor {

    // 🔹 Backend (trusted anchoring service — the CDP server wallet
    // named AUDIT_BACKEND_WALLET_NAME, see backend/app/services/audit/
    // anchor_service.py). Immutable: set once at deploy time to the CDP
    // account's own address (via an explicit constructor argument, not
    // msg.sender — the deploy transaction's sender is a throwaway local
    // key, not the CDP wallet itself; see
    // web3/scripts/deploy_audit_anchor.ts's own header comment for why),
    // never reassigned afterward.
    address public immutable backend;

    // 🔹 Events — the entire permanent record. batchIndex is indexed so
    // a specific anchor can be looked up directly via eth_getLogs
    // without scanning the whole event history (see anchor_service.py's
    // fetch_batch_anchor_event()).
    event Anchored(
        uint256 indexed batchIndex,
        bytes32 merkleRoot,
        bytes32 batchRootHash,
        uint256 timestamp
    );

    // 🔹 Restrict access to backend only
    modifier onlyBackend() {
        require(msg.sender == backend, "Only backend allowed");
        _;
    }

    // 🔹 Constructor
    constructor(address _backend) {
        backend = _backend;
    }

    /// @notice Anchors one sealed batch of the off-chain audit chain.
    /// @param batchIndex The AuditLogBatch.batch_index being anchored.
    /// @param merkleRoot Root of the Merkle tree over this batch's rows
    /// (leaf = sha256(0x00 || row.data_hash), domain-separated — see
    /// backend/app/services/audit/merkle_service.py) — lets a single row
    /// be proven present via a Merkle proof without trusting anything
    /// this platform's own database says.
    /// @param batchRootHash Commits this batch to every batch before it
    /// (folds in prev_batch_root_hash) — the ordering/chain-of-custody
    /// guarantee, equivalent to V1's chainTipHash but at the batch level.
    function anchor(
        uint256 batchIndex,
        bytes32 merkleRoot,
        bytes32 batchRootHash
    ) external onlyBackend {
        emit Anchored(batchIndex, merkleRoot, batchRootHash, block.timestamp);
    }
}
