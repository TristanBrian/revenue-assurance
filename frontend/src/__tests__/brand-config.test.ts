import { describe, it, expect } from "vitest";
import { BRAND_CONFIG } from "../lib/brand-config";

describe("BRAND_CONFIG", () => {
  it("has correct KPC Revenue Assurance branding tokens", () => {
    expect(BRAND_CONFIG.companyName).toBe("Kenya Pipeline Company");
    expect(BRAND_CONFIG.systemName).toBe("Reconova Revenue Assurance");
    expect(BRAND_CONFIG.shortName).toBe("Reconova");
    expect(BRAND_CONFIG.primaryColor).toBe("#B3312C");
    expect(BRAND_CONFIG.logoUrl).toBe("/svg/kpc-logo-transparent.svg");
  });
});
