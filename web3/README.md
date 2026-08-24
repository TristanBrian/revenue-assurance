# revenue-assurance web3

On-chain anchor for the immutable audit trail — see
`backend/app/models/audit/audit.py` and `backend/app/services/audit/`
for the off-chain hash chain this periodically commits to Base Sepolia.

Deploys and runs independently of `backend/`'s Python environment: own
Hardhat/pnpm toolchain, talking to the backend only via the deployed
contract address + RPC endpoint (`AUDIT_ANCHOR_CONTRACT_ADDRESS_V2`,
`BASE_RPC_URL` in `backend/.env` — see the versioning note below).

## What's here

- `contracts/AuditAnchor.sol` — currently **V2**: a single
  `anchor(batchIndex, merkleRoot, batchRootHash)` function,
  `onlyBackend`-gated, emitting an `Anchored` event. No storage beyond
  the backend address — the event log is the permanent record. Only two
  SHA-256-derived hashes ever go on-chain (a batch's Merkle root and its
  batch-root chain hash); no beneficiary, OMC, or financial data. See
  `backend/docs/audit-merkle-migration.md` for the batch Merkle cutover
  this version implements, and the "Versions" section below for how V1
  (the original per-row `anchor(blockIndex, chainTipHash)` contract,
  still live and still resolvable for anchors made before the cutover)
  relates to this one.
- `scripts/deploy_audit_anchor.ts` — deploys the contract with the CDP
  backend wallet as its immutable `backend` (constructor arg), funded
  and orchestrated by that same CDP wallet end to end. See the script's
  own header comment for why the actual CREATE transaction is submitted
  by a fresh, never-persisted throwaway local key rather than signed by
  CDP directly — CDP's managed EVM wallets currently reject any
  transaction with an empty `to` field (i.e. a raw contract deployment)
  as malformed, verified directly against a live account rather than
  assumed. The throwaway key never controls anything: `AuditAnchor.
  backend` is set from the CDP wallet's address regardless of who
  submitted the deploy transaction, so the contract's authorization
  model ends up identical either way.
- `test/AuditAnchor.ts` — backend-can-anchor / non-backend-cannot /
  event-shape tests, run against a local simulated network (no real
  network or CDP credentials needed).

## Setup

```bash
cd web3
pnpm install
cp .env.example .env   # fill in CDP_* — see .env.example
```

## Running tests

No network or credentials required — runs against Hardhat's local
simulated chain:

```bash
npx hardhat test
```

## Deploying to Base Sepolia

Requires real CDP credentials and a wallet funded with Base Sepolia ETH
(the backend's own anchor flow retries through the CDP faucet
automatically on insufficient balance — this deploy script does not,
since a deploy transaction is a one-off, not a recurring background job):

```bash
npx hardhat run scripts/deploy_audit_anchor.ts --network baseSepolia
```

On success, copy the printed address into `backend/.env`:

```env
AUDIT_ANCHOR_CONTRACT_ADDRESS_V2=0x...
AUDIT_BACKEND_WALLET_NAME=inuka-audit-backend
```

(`AUDIT_ANCHOR_CONTRACT_ADDRESS`, no suffix, is the separate V1 variable
— see "Versions" below. Don't overwrite it when deploying V2.)

Until `AUDIT_ANCHOR_CONTRACT_ADDRESS_V2` is set, the backend's V2
anchoring is inert — `anchor_service.is_configured_v2()` treats a
missing contract address the same way the alerts system treats missing
SMTP config: skipped and logged, not an error, since nothing was
actually attempted. `/audit/verify`'s on-chain check falls back to
reporting the V1 result in that state (see "Versions" below), or "not
configured" if neither is set.

## Versions

This contract has been redeployed once, for the batch Merkle cutover
(`backend/docs/audit-merkle-migration.md`) — V1 anchored a single
per-row chain-tip hash, V2 anchors a sealed batch's Merkle root instead.
Both can be configured at once; the backend resolves which one a given
`AuditAnchorRecord` row belongs to and reads it from the matching
contract/ABI (`app/abi/AuditAnchor.json` = V2/current,
`app/abi/AuditAnchorV1.json` = V1/legacy) — see
`anchor_service.verify_on_chain_anchor()`'s era dispatch.

**V1 — already deployed, still live, for legacy anchors:**

- Contract: [`0x1512cab2a67bc407226c143cf59ad4d7b4d5248e`](https://sepolia.basescan.org/address/0x1512cab2a67bc407226c143cf59ad4d7b4d5248e)
- Backend wallet (`AuditAnchor.backend`): `0x74A457A39a84B342EAFF484b18DbAFd6685f5171` (CDP account named `inuka-audit-backend`)
- `AUDIT_ANCHOR_CONTRACT_ADDRESS` (no suffix) in the repo-root `.env`.
  Keep this set — it's what resolves any anchor made before the cutover.
  No redeploy needed for V1 ever again; it's a closed, historical
  record now.

**V2 — batch Merkle anchor, deploy when ready:**

Not yet deployed as of this migration landing. Follow "Deploying to Base
Sepolia" above when you're ready to start anchoring sealed batches — the
same throwaway-key deploy pattern, same CDP wallet (`getOrCreateAccount`
is idempotent, so it's the same `backend` address as V1), just a new
contract instance at a new address. Set
`AUDIT_ANCHOR_CONTRACT_ADDRESS_V2` afterward; leave
`AUDIT_ANCHOR_CONTRACT_ADDRESS` exactly as it is.
