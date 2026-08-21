import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, keccak256, toHex, type Address, type WalletClient } from "viem";

// ────────────────────────────────────────────────────────────────────────────

describe("AuditAnchor", async function () {
  const { viem } = await network.create();

  async function deployFixture() {
    const [backend, other] = await viem.getWalletClients();

    const auditAnchor = await viem.deployContract("AuditAnchor", [
      backend.account.address,
    ]);

    return { auditAnchor, backend, other };
  }

  async function auditAnchorAs(address: Address, wallet: WalletClient) {
    return viem.getContractAt("AuditAnchor", address, { client: { wallet } });
  }

  const SAMPLE_HASH = keccak256(toHex("sample chain tip"));

  // ── backend can anchor ─────────────────────────────────────────────────────
  it("backend can anchor a block", async () => {
    const { auditAnchor, backend } = await deployFixture();

    const a = await auditAnchorAs(auditAnchor.address, backend);
    await a.write.anchor([35040n, SAMPLE_HASH]);

    const events = await auditAnchor.getEvents.Anchored();
    assert.equal(events.length, 1);
    assert.equal(events[0].args.blockIndex, 35040n);
    assert.equal(events[0].args.chainTipHash, SAMPLE_HASH);
  });

  // ── non-backend cannot anchor ──────────────────────────────────────────────
  it("non-backend cannot anchor", async () => {
    const { auditAnchor, other } = await deployFixture();

    const a = await auditAnchorAs(auditAnchor.address, other);
    await assert.rejects(
      a.write.anchor([0n, SAMPLE_HASH]),
      /Only backend allowed/
    );
  });

  // ── backend address is set correctly at deploy ─────────────────────────────
  it("records the constructor's backend address immutably", async () => {
    const { auditAnchor, backend } = await deployFixture();
    const onChainBackend = await auditAnchor.read.backend();
    assert.equal(getAddress(onChainBackend), getAddress(backend.account.address));
  });

  // ── multiple anchors chain independently ───────────────────────────────────
  it("emits one event per anchor call, in order", async () => {
    const { auditAnchor, backend } = await deployFixture();
    const a = await auditAnchorAs(auditAnchor.address, backend);

    await a.write.anchor([0n, keccak256(toHex("first"))]);
    await a.write.anchor([50n, keccak256(toHex("second"))]);

    // fromBlock explicit: getEvents.Anchored() with no range only
    // returns events since the last time it was called on this contract
    // instance, not the full history — this test wants everything since
    // deployment.
    const events = await auditAnchor.getEvents.Anchored({}, { fromBlock: 0n });
    assert.equal(events.length, 2);
    assert.equal(events[0].args.blockIndex, 0n);
    assert.equal(events[1].args.blockIndex, 50n);
  });
});
