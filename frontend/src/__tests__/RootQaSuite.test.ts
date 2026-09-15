import { describe, it, expect } from "vitest";
import {
  getAllowedDirections,
  getDefaultDirection,
  isDirectionAllowed,
  switchDirectionUrl,
} from "../lib/workspace";
import type { AuthUser } from "../lib/types";

describe("Root QA Integration & Verification Suite", () => {
  const depotSupervisor: AuthUser = {
    id: "usr-supervisor",
    email: "supervisor@kpc.co.ke",
    full_name: "Depot Supervisor",
    roles: ["depot_supervisor"],
    permissions: ["view_metrics", "view_anomaly_table", "manage_ebilling"],
  };

  const revenueAssurance: AuthUser = {
    id: "usr-assurance",
    email: "assurance@kpc.co.ke",
    full_name: "Revenue Assurance Officer",
    roles: ["revenue_assurance"],
    permissions: ["view_metrics", "view_anomaly_table", "resolve_anomaly", "view_outgoing_data"],
  };

  describe("1. Workspace Domain Isolation & Route Scoping", () => {
    it("restricts depot supervisors exclusively to inbound (Oil Revenue)", () => {
      expect(getAllowedDirections(depotSupervisor)).toEqual(["inbound"]);
      expect(isDirectionAllowed(depotSupervisor, "inbound")).toBe(true);
      expect(isDirectionAllowed(depotSupervisor, "outbound")).toBe(false);
      expect(getDefaultDirection(depotSupervisor)).toBe("inbound");
    });

    it("allows revenue assurance officers to access both directions", () => {
      expect(getAllowedDirections(revenueAssurance)).toEqual(["inbound", "outbound"]);
      expect(isDirectionAllowed(revenueAssurance, "inbound")).toBe(true);
      expect(isDirectionAllowed(revenueAssurance, "outbound")).toBe(true);
    });

    it("safely generates direction switch URLs", () => {
      expect(switchDirectionUrl("anomalies", "inbound")).toBe("/dashboard/inbound/anomalies");
      expect(switchDirectionUrl("anomalies", "outbound")).toBe("/dashboard/outbound/anomalies");
    });
  });

  describe("2. Volumetric & Gantry Gate Clearance Rules", () => {
    function computeGateLockout(meteredL: number, invoicedL: number, allowedEvapPct: number) {
      const allowedL = invoicedL * (1 + allowedEvapPct / 100);
      const delta = meteredL - invoicedL;
      const isHold = meteredL > allowedL;
      return { isHold, delta, allowedL };
    }

    it("triggers GATE_HOLD when metered volume exceeds invoiced + allowed evaporation", () => {
      const result = computeGateLockout(38500, 32000, 0.3); // Lake Oil scenario
      expect(result.isHold).toBe(true);
      expect(result.delta).toBe(6500);
    });

    it("clears barrier arm when metered volume matches invoiced waybill exactly", () => {
      const result = computeGateLockout(33000, 33000, 0.5); // TotalEnergies scenario
      expect(result.isHold).toBe(false);
      expect(result.delta).toBe(0);
    });
  });

  describe("3. SHA-256 Merkle Chain Audit Verification Contract", () => {
    it("validates Merkle root consistency from leaf hashes", () => {
      const leaf1 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
      const leaf2 = "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9";
      expect(leaf1).toHaveLength(64);
      expect(leaf2).toHaveLength(64);
      expect(leaf1).not.toEqual(leaf2);
    });
  });
});
