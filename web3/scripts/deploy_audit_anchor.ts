/**
 * Deploys AuditAnchor.sol to Base Sepolia, with the CDP backend wallet
 * as the contract's immutable `backend` — the only address ever
 * authorized to call anchor() afterward.
 *
 * WHY THIS ISN'T A DIRECT CDP-SIGNED DEPLOYMENT (read before "fixing"
 * this): CDP server wallets' sendTransaction() rejects any transaction
 * with an empty `to` field — i.e. a raw contract-creation transaction —
 * as "Malformed unsigned EIP-1559 transaction", regardless of how it's
 * encoded. This was verified directly, not assumed: an identical
 * transaction with a real `to` address (a plain self-transfer) succeeds
 * through this exact account and code path; only the empty-`to`
 * (deployment) case is rejected. This is a real constraint of CDP's
 * managed EVM wallets today, not a bug in this script — there is no
 * separate "deploy contract" endpoint in the CDP SDK to use instead
 * (checked: no such method exists on EvmServerAccount or the top-level
 * client).
 *
 * The workaround: a throwaway LOCAL private key, generated fresh every
 * run and never persisted, submits the actual CREATE transaction — but
 * the constructor argument is still the CDP wallet's address, not the
 * throwaway key's. Ethereum's CREATE semantics only care about the
 * constructor args for what a contract's own state ends up holding;
 * AuditAnchor.sol sets `backend = _backend` from that argument, not
 * from `msg.sender`. So the deployed contract's authorization model
 * ends up identical to a CDP-signed deploy would have produced — only
 * the CDP wallet can ever call anchor() — even though a different key
 * happened to pay the one-time deploy gas. The throwaway key is funded
 * by ONE CDP-signed transfer from the backend wallet (proven to work
 * above) for exactly the gas the deployment needs, and never reused for
 * anything afterward.
 *
 * If CDP adds contract-creation support to sendTransaction() in the
 * future, this script should switch back to a direct CDP-signed deploy
 * (see git history on this file for that version) — the workaround
 * exists only because of the current API limitation, not by design
 * preference.
 *
 * Usage (from web3/, after `pnpm install` and populating .env — see
 * .env.example):
 *   npx hardhat run scripts/deploy_audit_anchor.ts --network baseSepolia
 *
 * On success, copy the printed contract address into the backend's
 * .env as AUDIT_ANCHOR_CONTRACT_ADDRESS — see
 * backend/app/services/audit/anchor_service.py.
 */
import { network } from "hardhat";
import { CdpClient } from "@coinbase/cdp-sdk";
import {
  encodeDeployData,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same named account backend/app/services/audit/anchor_service.py uses
// via cdp.evm.get_or_create_account(name=...) — get_or_create is
// idempotent, so running this script again reuses the same backend
// wallet/address rather than creating a new one, and the backend
// service will resolve to the exact address this contract was deployed
// with.
const AUDIT_BACKEND_WALLET_NAME = process.env.AUDIT_BACKEND_WALLET_NAME || "inuka-audit-backend";
const NETWORK = "base-sepolia";
// Comfortably above what deploying this small a contract costs on Base
// Sepolia (observed gas price ~0.006 gwei; a few hundred thousand gas
// units costs a small fraction of this) — cheap enough that overfunding
// the throwaway key by a wide margin is still negligible.
const DEPLOY_GAS_FUNDING = parseEther("0.00005");

async function main() {
  const cdp = new CdpClient({
    apiKeyId: process.env.CDP_API_KEY_ID!,
    apiKeySecret: process.env.CDP_API_KEY_SECRET!,
    walletSecret: process.env.CDP_WALLET_SECRET!,
  });

  const backendAccount = await cdp.evm.getOrCreateAccount({ name: AUDIT_BACKEND_WALLET_NAME });
  console.log("🚀 CDP backend wallet (will be AuditAnchor.backend):", backendAccount.address);

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  // --- Step 1: fund a fresh, one-time-use local key from the CDP wallet ---
  const deployerPrivateKey = generatePrivateKey();
  const deployerAccount = privateKeyToAccount(deployerPrivateKey);
  console.log("🔑 Throwaway deploy key (never persisted, never reused):", deployerAccount.address);

  console.log(`💸 Funding it with ${DEPLOY_GAS_FUNDING} wei from the CDP wallet...`);
  const fundingNonce = await publicClient.getTransactionCount({
    address: backendAccount.address as Address,
    blockTag: "pending",
  });
  const feeData = await publicClient.estimateFeesPerGas();
  const { transactionHash: fundingTxHash } = await backendAccount.sendTransaction({
    transaction: {
      to: deployerAccount.address,
      value: DEPLOY_GAS_FUNDING,
      nonce: fundingNonce,
      gas: 21000n,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    },
    network: NETWORK,
  });
  console.log("   funding tx:", fundingTxHash);
  await publicClient.waitForTransactionReceipt({ hash: fundingTxHash as Hex });
  console.log("   ✅ funded");

  // --- Step 2: deploy from the throwaway key, CDP wallet as constructor arg ---
  const artifactPath = path.join(
    __dirname, "..", "artifacts", "contracts", "AuditAnchor.sol", "AuditAnchor.json"
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));

  const deployerWalletClient = createWalletClient({
    account: deployerAccount,
    chain: baseSepolia,
    transport: http(process.env.BASE_RPC_URL || "https://sepolia.base.org"),
  });

  console.log("📡 Deploying AuditAnchor.sol...");
  const deployTxHash = await deployerWalletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
    args: [backendAccount.address as Address],
  });
  console.log("   deploy tx:", deployTxHash);

  console.log("⏳ Waiting for confirmation...");
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTxHash });

  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`Deployment transaction did not succeed as expected: ${JSON.stringify(receipt)}`);
  }

  console.log("✅ AuditAnchor deployed at:", receipt.contractAddress);

  // --- Step 3: sweep any unspent gas back to the CDP wallet (best-effort) ---
  try {
    const remaining = await publicClient.getBalance({ address: deployerAccount.address });
    const sweepFeeData = await publicClient.estimateFeesPerGas();
    // 2x buffer: gas price can tick up between this estimate and the
    // actual send, and the throwaway key's private key is never saved
    // anywhere — any dust this undershoots strands permanently, unlike
    // a normal wallet where you could just resend. Observed a real
    // ~2.6M-wei shortfall from a 1x estimate on a live run.
    const sweepCost = 2n * 21000n * (sweepFeeData.maxFeePerGas ?? 0n);
    if (remaining > sweepCost) {
      const sweepTxHash = await deployerWalletClient.sendTransaction({
        to: backendAccount.address as Address,
        value: remaining - sweepCost,
        gas: 21000n,
        maxFeePerGas: sweepFeeData.maxFeePerGas,
        maxPriorityFeePerGas: sweepFeeData.maxPriorityFeePerGas,
      });
      console.log("🧹 Swept unspent gas back to the CDP wallet:", sweepTxHash);
    }
  } catch (sweepErr) {
    console.log("(non-fatal) Could not sweep leftover throwaway-key balance:", sweepErr);
  }

  // V2 (batch Merkle anchor — see backend/docs/audit-merkle-migration.md
  // and AuditAnchor.sol's own module docstring): printed as
  // AUDIT_ANCHOR_CONTRACT_ADDRESS_V2, a NEW env var, not overwriting
  // AUDIT_ANCHOR_CONTRACT_ADDRESS — that one still needs to point at the
  // original V1 contract so anchor_service.py's legacy path can keep
  // resolving pre-cutover on-chain anchors after this deploy.
  console.log("\nUpdate the backend's .env:");
  console.log(`AUDIT_ANCHOR_CONTRACT_ADDRESS_V2=${receipt.contractAddress}`);
  console.log(`AUDIT_BACKEND_WALLET_NAME=${AUDIT_BACKEND_WALLET_NAME}`);
  console.log("\n(Leave the existing AUDIT_ANCHOR_CONTRACT_ADDRESS as-is — do not overwrite it.)");
}

main().catch((err) => {
  console.error("❌ Deployment failed:", err);
  process.exit(1);
});
