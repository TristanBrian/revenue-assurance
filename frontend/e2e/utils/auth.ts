import type { Page } from "@playwright/test";

// Seeded by backend/scripts/seed_demo_users.py — same demo accounts the
// backend README's Quick Start documents. revenue_assurance has both
// view_fraud_graph and view_outgoing_data, so it can reach the Risk
// Intelligence page on both inbound and outbound workspaces (see
// getAllowedDirections() in src/lib/workspace.tsx).
export const DEMO_USER = {
  email: "revenue_assurance@kpc-demo.co.ke",
  password: "demo-pass-123",
};

export async function login(page: Page, user = DEMO_USER): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Login redirects to /dashboard, which itself redirects to
  // /dashboard/<direction>/overview — wait for that final hop.
  // Generous timeout: Next dev compiles each route on first request, and
  // this is often the very first navigation of the whole run — later
  // navigations to already-compiled routes are fast (see the risk-page
  // waits below, at their normal 15s).
  await page.waitForURL(/\/dashboard\/(inbound|outbound)\/overview/, { timeout: 30_000 });
}
