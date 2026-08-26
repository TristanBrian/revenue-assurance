import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:3000";

test("Audit Trail — Verify Audit Trail renders both the local-chain and on-chain-anchor cards", async ({ page }) => {
  test.setTimeout(90_000); // verifying ~600k rows server-side is slow, not hung
  await page.goto(`${APP_URL}/login`);
  await page.locator("#email").fill("revenue_assurance@kpc-demo.co.ke");
  await page.locator("#password").fill("demo-pass-123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard\/(inbound|outbound)\/overview/, { timeout: 30_000 });

  await page.goto(`${APP_URL}/dashboard/audit`);
  await expect(page.locator(".animate-spin")).toHaveCount(0, { timeout: 15_000 });

  await page.getByRole("button", { name: "Verify Audit Trail" }).click();
  // Verifying every batch server-side over ~600k rows is genuinely slow —
  // not a hung request.
  await expect(page.getByText("Local Chain Integrity")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("On-Chain Anchor (Base Sepolia)")).toBeVisible();

  await page.screenshot({ path: "e2e/screenshots/audit-verify-panel.png", fullPage: true });
});
