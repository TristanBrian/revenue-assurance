import { test, expect, type Page } from "@playwright/test";
const permissions = ["view_metrics", "view_anomaly_table", "view_outgoing_data", "view_heatmap", "view_omc_risk_profile", "export_reports", "view_fraud_graph", "resolve_anomaly", "manage_ebilling", "upload_csv"];
async function mockWorkspace(page: Page, role = "revenue_assurance") {
  const requests: string[] = [];
  await page.route("https://www.chatbase.co/**", (route) => route.abort());
  await page.context().addCookies([{ name: "kpc_auth_token", value: "ui-test-only", domain: "localhost", path: "/" }]);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()); requests.push(url.pathname);
    let data: unknown = {};
    if (url.pathname.endsWith("/auth/me")) data = { id: "ui-test-user", email: "reviewer@example.test", roles: [role], permissions: role === "inuka_manager" ? permissions.filter((p) => !["resolve_anomaly", "manage_ebilling", "upload_csv"].includes(p)) : permissions };
    else if (url.pathname.endsWith("/metrics")) data = { metrics: { total_dispatched_kes: 40000000, total_invoiced_kes: 38000000, total_paid_kes: 37000000, total_leakage_kes: 3000000, reconciliation_rate: 94.5, missing_invoice_leak: 1800000, missing_payment_leak: 600000, underpayment_leak: 500000, overpayment_leak: 100000, ghost_payment_leak: 400000, duplicate_disbursement_leak: 100000, anomaly_count: 24, critical_count: 3, pending_count: 18, review_count: 3 }, data_quality: { quality_score: 98.1 } };
    else if (url.pathname.endsWith("/omc-risk-profile")) data = { omc_risk_profile: [{ customer: "Demo OMC", leakage_kes: 3000000, anomaly_count: 24, risk_level: "High" }] };
    else if (url.pathname.endsWith("/trend")) data = { series: [1,2,3,4,5,6,7].map((day) => ({ date: `2026-09-0${day}`, exposure_identified_kes: 1800000 + day * 150000, recovered_kes: day * 120000 })) };
    else if (url.pathname.endsWith("/anomalies")) data = { anomalies: [], pagination: { total: 0, page: 1, total_pages: 0 } };
    else if (url.pathname.endsWith("/cases")) data = { cases: [], summary: { case_count: 24, critical_count: 3, amount_at_risk: 3000000 }, pagination: { total: 0 } };
    else if (/\/(pillars|officers)$/.test(url.pathname)) data = [];
    else if (url.pathname.endsWith("/gantry-lanes")) data = { source: "synthetic_demo", lanes: ["green", "yellow", "red"].map((status, i) => ({ lane_id: i+1, lane_name: `Gantry Lane ${i+1}`, status, current_truck_id: `DEMO ${i+1}`, omc_name: "Demo OMC", product_code: "AGO", meter_volume_l: 34000+i*100, invoiced_volume_l: 34000, dwell_time_mins: 25+i*15, free_time_limit_mins: 45, automated_hold_reason: i===2 ? "Sample volume mismatch" : null, gate_clearance: i===2 ? "HELD" : "ISSUED" })), summary: {} };
    else if (url.pathname.endsWith("/e-billing/status")) data = { integration: { failed_count: 0 } };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Success: 1, Data: data }) });
  });
  return requests;
}
test.use({ launchOptions: { executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] } });
test("Oil overview is concise; module search, filters and keyboard inspector work", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (err) => errors.push(err.message));
  await mockWorkspace(page);
  await page.goto("/dashboard/inbound/overview");
  await expect(page.getByRole("button", { name: "Refresh overview" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Loading lanes" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/oil-overview.png", fullPage: true });
  await page.getByRole("textbox", { name: "Find a workspace module" }).fill("depot");
  await page.getByRole("link", { name: "Depot Operations", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Depot operations" })).toBeVisible();
  await page.getByRole("button", { name: /^Hold ·/ }).click();
  await expect(page.getByRole("button", { name: /^Inspect Gantry/ })).toHaveCount(1);
  await page.getByRole("button", { name: /^Inspect Gantry/ }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("Inuka makes no oil requests and rejects an oil module by direct URL", async ({ page }) => {
  const requests = await mockWorkspace(page, "inuka_manager");
  await page.goto("/dashboard/outbound/overview");
  await expect(page.getByRole("button", { name: "Refresh overview" })).toBeEnabled();
  await expect(page.getByRole("navigation").getByRole("link", { name: "E-Billing" })).toHaveCount(0);
  await expect(page.getByRole("navigation").getByRole("link", { name: "Beneficiaries" })).toBeVisible();
  expect(requests.some((p) => /gantry|e-billing|omc-risk|reconcile\/trend/.test(p))).toBe(false);
  await page.screenshot({ path: "test-results/inuka-overview.png", fullPage: true });
  await page.goto("/dashboard/outbound/billing");
  await expect(page.getByRole("heading", { name: "Module unavailable" })).toBeVisible();
});
test("Mobile layout fits the viewport and opens workspace navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await mockWorkspace(page, "inuka_manager");
  await page.goto("/dashboard/outbound/overview");
  await expect(page.getByRole("button", { name: "Refresh overview" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/inuka-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Beneficiaries" })).toBeVisible();
});
