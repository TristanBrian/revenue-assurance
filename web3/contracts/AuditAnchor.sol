// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title AuditAnchor
/// @notice On-chain anchor for the off-chain immutable audit trail
/// (backend/app/models/audit/audit.py's hash-chained audit_logs table).
/// Stores nothing beyond `backend` — the Anchored event log IS the
/// permanent record. Only a SHA-256 hash of the current chain tip is
/// ever written here; no beneficiary, OMC, or financial data touches
/// this contract or appears in any transaction/event it emits.
contract AuditAnchor {

    // 🔹 Backend (trusted anchoring service — the CDP server wallet
    // named AUDIT_BACKEND_WALLET_NAME, see backend/app/services/audit/
    // anchor_service.py). Immutable: set once at deploy time to the CDP
    // account's own address (it deploys this contract itself — see
    // scripts/deploy_audit_anchor.ts), never reassigned afterward.
    address public immutable backend;

    // 🔹 Events — the entire permanent record. blockIndex is indexed so
    // a specific anchor can be looked up directly via eth_getLogs
    // without scanning the whole event history (see anchor_service.py's
    // fetch_anchor_event()).
    event Anchored(uint256 indexed blockIndex, bytes32 chainTipHash, uint256 timestamp);

    // 🔹 Restrict access to backend only
    modifier onlyBackend() {
        require(msg.sender == backend, "Only backend allowed");
        _;
    }

    // 🔹 Constructor
    constructor(address _backend) {
        backend = _backend;
    }

    /// @notice Anchors the off-chain audit chain's current tip.
    /// @param blockIndex The chain-tip row's block_index at anchor time.
    /// @param chainTipHash The chain-tip row's block_hash (sha256, as
    /// bytes32) — commits to every row up to and including it, since
    /// the off-chain chain already commits each row to the one before
    /// it. One anchor call covers the whole chain up to this point, not
    /// just the rows added since the last anchor.
    function anchor(uint256 blockIndex, bytes32 chainTipHash) external onlyBackend {
        emit Anchored(blockIndex, chainTipHash, block.timestamp);
    }
}
