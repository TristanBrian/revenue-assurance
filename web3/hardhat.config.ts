import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";
import "dotenv/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    // No `accounts` here on purpose: scripts/deploy_audit_anchor.ts signs
    // its own deployment through the CDP backend wallet (a viem wallet
    // client wrapping the CDP account, built directly in the script) —
    // not through a private key configured on this network entry. See
    // that script's header comment for why (mirrors deploy_trace.ts's
    // pattern in the Mavuno_Pay_Web3 reference project, not
    // deploy_escrow.ts's — the latter needs a separately-funded EOA
    // deploy key, which this project deliberately avoids).
    baseSepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.BASE_RPC_URL || "https://sepolia.base.org",
    },
  },
});
