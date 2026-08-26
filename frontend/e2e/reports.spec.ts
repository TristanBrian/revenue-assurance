import { test, expect } from "@playwright/test";
import { login } from "./utils/auth";

// Regression test for a real bug: the Reports page's evidence table read
// `anomalies` off getMetrics()'s response (POST /api/reconcile/metrics),
// a field that endpoint's schema deliberately never returns — anomaly
// rows live at the separate getAnomalies() endpoint. The table was
// permanently empty ("0 of 0 records") for every report type and
// direction until fixed in page.tsx to actually call getAnomalies().

for (const direction of ["inbound", "outbound"] as const) {
  test(`Reports page (${direction}) — evidence table is populated, not permanently empty`, async ({ page }) => {
    await login(page);
    await page.goto(`/dashboard/${direction}/reports`);
    await page.getByText("Loading live report data…").waitFor({ state: "detached", timeout: 20_000 });

    // Financial settlement — present on both directions (unlike iCMS,
    // inbound-only) and, at the seeded demo data's default materiality,
    // reliably non-empty on both sides.
    await page.getByRole("tab", { name: "Financial settlement" }).click();
    await page.waitForTimeout(800);

    const noMatch = await page.getByText("No records match").count();
    const summary = await page.locator("text=/of \\d+ records/").first().textContent();
    expect(noMatch, `${direction}: evidence table shows the empty state instead of real rows`).toBe(0);
    expect(summary, `${direction}: pagination summary should report a nonzero record count`).not.toMatch(/^0 of 0/);
  });
}
