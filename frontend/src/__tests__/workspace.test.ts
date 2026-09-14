import { describe, expect, it } from "vitest";
import { activeNavItemId, canAccessModule, getAllowedDirections, navItems, switchDirectionUrl } from "@/lib/workspace";
import type { AuthUser } from "@/lib/types";
const user = (roles: string[], permissions: string[]) => ({ roles, permissions } as AuthUser);
const moduleById = (id: string) => navItems.find((item) => item.id === id)!;
describe("Workspace permission boundaries", () => {
  it("fails closed before authentication and for administrative-only roles", () => {
    expect(getAllowedDirections(null)).toEqual([]);
    expect(getAllowedDirections(user(["system_admin"], ["manage_users"]))).toEqual([]);
  });
  it("keeps Inuka accounts out of every oil-only module", () => {
    const inuka = user(["inuka_manager"], ["view_metrics", "view_anomaly_table", "view_outgoing_data", "manage_ebilling"]);
    for (const id of ["operations", "billing", "upload"]) {
      expect(canAccessModule(inuka, moduleById(id), "outbound")).toBe(false);
      expect(canAccessModule(inuka, moduleById(id), "inbound")).toBe(false);
    }
    expect(canAccessModule(inuka, moduleById("beneficiaries"), "outbound")).toBe(true);
  });
  it("does not grant billing merely because a manager can view cases", () => {
    const manager = user(["manager"], ["view_anomaly_table", "view_outgoing_data"]);
    expect(canAccessModule(manager, moduleById("billing"), "inbound")).toBe(false);
    expect(canAccessModule(manager, moduleById("beneficiaries"), "outbound")).toBe(true);
  });
  it("keeps depot roles oil-only even with a conflicting outgoing permission", () => {
    expect(getAllowedDirections(user(["depot_supervisor"], ["view_outgoing_data"]))).toEqual(["inbound"]);
  });
  it("switches unrelated modules to overview and preserves shared modules", () => {
    expect(switchDirectionUrl("billing", "outbound")).toBe("/dashboard/outbound/overview");
    expect(switchDirectionUrl("beneficiaries", "inbound")).toBe("/dashboard/inbound/overview");
    expect(switchDirectionUrl("anomalies", "outbound")).toBe("/dashboard/outbound/anomalies");
    expect(activeNavItemId("/dashboard/outbound/extra")).toBe("beneficiaries");
  });
});
