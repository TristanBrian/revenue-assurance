import { test, expect } from "@playwright/test";
import { login } from "./utils/auth";

// Reads a node's true geometry straight off the SVG shape it rendered as
// — cx/cy/r for the OUTER_TYPES circles, x/y/width for the leaf-type
// rects (square, so width === the rect's own diameter) — normalized to a
// common {x, y, r} circle so both shapes can be checked against each
// other with one formula. Selecting `[stroke]` scopes to exactly the
// node's visible shape: the invisible larger hit-circle
// (fill="transparent") and the pulsing high-risk halo (fill + fillOpacity,
// no stroke) both lack a stroke attribute, and edges are <line>s, not
// circle/rect, so this can't accidentally pick either up.
async function readNodeCircles(svg: import("@playwright/test").Locator) {
  return svg.evaluate((svgEl) => {
    const shapes = Array.from(svgEl.querySelectorAll("circle[stroke], rect[stroke]"));
    return shapes.map((el) => {
      if (el.tagName.toLowerCase() === "circle") {
        return {
          x: parseFloat(el.getAttribute("cx") || "0"),
          y: parseFloat(el.getAttribute("cy") || "0"),
          r: parseFloat(el.getAttribute("r") || "0"),
        };
      }
      const x = parseFloat(el.getAttribute("x") || "0");
      const y = parseFloat(el.getAttribute("y") || "0");
      const width = parseFloat(el.getAttribute("width") || "0");
      return { x: x + width / 2, y: y + width / 2, r: width / 2 };
    });
  });
}

function assertNoOverlaps(circles: { x: number; y: number; r: number }[]) {
  let worst = Infinity;
  let violations = 0;
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i];
      const b = circles[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const gap = dist - (a.r + b.r);
      worst = Math.min(worst, gap);
      // Small negative tolerance for SVG sub-pixel rounding, not real overlap.
      if (gap < -0.5) violations++;
    }
  }
  return { violations, worst };
}

for (const direction of ["inbound", "outbound"] as const) {
  test(`${direction} fraud graph — nodes render with no overlap`, async ({ page }) => {
    await login(page);
    await page.goto(`/dashboard/${direction}/risk`);

    // Scoped by viewBox (WIDTH×HEIGHT from FraudGraph.tsx), not just
    // "svg" — the dashboard chrome (icons, theme toggle, chatbot widget)
    // has its own <svg>s on this page, and a plain "svg" locator's
    // .first() silently grabs one of those instead.
    const svg = page.locator('svg[viewBox="0 0 680 460"]').first();
    await expect(svg).toBeVisible({ timeout: 15_000 });
    // Wait for the fetch-then-layout render to actually land — the spinner
    // (animate-spin) is gone once graph data + laidOutNodes are in.
    await expect(page.locator(".animate-spin")).toHaveCount(0, { timeout: 15_000 });

    const circles = await readNodeCircles(svg);
    expect(circles.length, "expected the graph to render at least one node").toBeGreaterThan(0);

    const { violations, worst } = assertNoOverlaps(circles);
    console.log(`[${direction}] ${circles.length} nodes, worst gap = ${worst.toFixed(2)}px`);
    expect(violations, `${violations} overlapping node pair(s) in the ${direction} graph`).toBe(0);

    // Every node must also stay within the SVG's own viewBox — an
    // off-canvas node is a layout bug even if nothing overlaps.
    const viewBox = await svg.evaluate((el) => el.getAttribute("viewBox"));
    const [, , vbW, vbH] = (viewBox ?? "0 0 0 0").split(" ").map(Number);
    const offCanvas = circles.filter(
      (c) => c.x - c.r < -0.5 || c.x + c.r > vbW + 0.5 || c.y - c.r < -0.5 || c.y + c.r > vbH + 0.5,
    );
    expect(offCanvas.length, "node(s) rendered outside the graph's viewBox").toBe(0);

    await page.screenshot({ path: `e2e/screenshots/fraud-graph-${direction}.png`, fullPage: true });
  });
}

test("clicking a node opens the Node Inspector with its details", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/inbound/risk");

  const svg = page.locator('svg[viewBox="0 0 680 460"]').first();
  await expect(svg).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".animate-spin")).toHaveCount(0, { timeout: 15_000 });

  // Node groups are the clickable <g>s wrapping each shape.
  const firstNodeGroup = svg.locator("g.cursor-pointer").first();
  await expect(firstNodeGroup).toBeVisible();
  await firstNodeGroup.click();

  const inspector = page.getByText("Node Inspector").locator("..");
  await expect(inspector.getByText(/Risk$/)).toBeVisible();
  await expect(inspector.getByText("Leakage Value")).toBeVisible();
  await expect(inspector.getByText("Anomalies Count")).toBeVisible();
});
