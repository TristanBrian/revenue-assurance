# revenue-assurance web3

On-chain anchor for the immutable audit trail — see
`backend/app/models/audit/audit.py` and `backend/app/services/audit/`
for the off-chain hash chain this periodically commits to Base Sepolia.

Deploys and runs independently of `backend/`'s Python environment: own
Hardhat/pnpm toolchain, talking to the backend only via the deployed
contract address + RPC endpoint (`AUDIT_ANCHOR_CONTRACT_ADDRESS`,
`BASE_RPC_URL` in `backend/.env`).

## What's here

- `contracts/AuditAnchor.sol` — a single `anchor(blockIndex, chainTipHash)`
  function, `onlyBackend`-gated, emitting an `Anchored` event. No storage
  beyond the backend address — the event log is the permanent record.
  Only a SHA-256 hash ever goes on-chain; no beneficiary, OMC, or
  financial data.
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
AUDIT_ANCHOR_CONTRACT_ADDRESS=0x...
AUDIT_BACKEND_WALLET_NAME=inuka-audit-backend
```

Until that's set, the backend's anchoring is inert — `anchor_service.py`
treats a missing contract address the same way the alerts system treats
missing SMTP config: skipped and logged, not an error, since nothing was
actually attempted. `/audit/verify`'s on-chain check reports
"not configured" rather than failing in that state.

### Already deployed

`AuditAnchor.sol` is live on Base Sepolia:

- Contract: [`0x1512cab2a67bc407226c143cf59ad4d7b4d5248e`](https://sepolia.basescan.org/address/0x1512cab2a67bc407226c143cf59ad4d7b4d5248e)
- Backend wallet (`AuditAnchor.backend`): `0x74A457A39a84B342EAFF484b18DbAFd6685f5171` (CDP account named `inuka-audit-backend`)

`AUDIT_ANCHOR_CONTRACT_ADDRESS` is already set in the repo-root `.env` —
no redeploy needed unless the contract itself changes. Re-running
`deploy_audit_anchor.ts` reuses the same CDP wallet (`getOrCreateAccount`
is idempotent) but deploys a *new* contract instance at a new address —
only do that deliberately, and update `AUDIT_ANCHOR_CONTRACT_ADDRESS`
afterward.
