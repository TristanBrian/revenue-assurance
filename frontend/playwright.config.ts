import { defineConfig, devices } from "@playwright/test";

// Runs against its own `next dev` instance on 3001, not the Docker
// `kpc-frontend` container on 3000 — keeps this from fighting the
// already-running demo stack for the port. 3001 (not some arbitrary free
// port) matters here: the backend's CORS_ORIGINS defaults to
// "http://localhost:3000,http://localhost:3001" (see backend/app/main.py)
// — anything else gets silently rejected by CORS and login just fails
// with "Could not reach the API". Still talks to the real backend
// (kpc-backend on :8000, started via `docker compose up`), same as
// api.ts's default NEXT_PUBLIC_API_URL fallback, so no env override is
// needed here.
const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Serial, not parallel: these all share one `next dev` instance (see
  // webServer below), and Next dev compiles each route on first request —
  // several workers hitting first-time routes at once turns that
  // on-demand compile into contention that blows past normal navigation
  // timeouts. Not worth tuning around for a handful of e2e specs.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
