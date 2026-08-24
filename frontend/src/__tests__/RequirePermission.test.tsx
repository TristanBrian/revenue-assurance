import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import RequirePermission from "../components/RequirePermission";
import * as authContext from "../lib/auth-context";

vi.mock("../lib/auth-context", () => ({
  useAuth: vi.fn(),
}));

describe("RequirePermission Component", () => {
  it("renders loading state when auth is loading", () => {
    vi.spyOn(authContext, "useAuth").mockReturnValue({
      user: null,
      loading: true,
      login: vi.fn(),
      logout: vi.fn(),
      acceptTerms: vi.fn(),
      // termsRequired removed
    });

    render(
      <RequirePermission code="view_anomaly_table">
        <div>Protected Content</div>
      </RequirePermission>
    );

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("renders Not Authorized message when user lacks permission", () => {
    vi.spyOn(authContext, "useAuth").mockReturnValue({
      user: {
        id: "1",
        email: "user@kpc.co.ke",
        full_name: "Test User",
        roles: ["viewer"],
        permissions: ["view_dashboard"],
      },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      acceptTerms: vi.fn(),
      // termsRequired removed
    });

    render(
      <RequirePermission code="resolve_anomalies">
        <div>Protected Resolution Panel</div>
      </RequirePermission>
    );

    expect(screen.getByText("Not authorized")).toBeInTheDocument();
    expect(screen.queryByText("Protected Resolution Panel")).not.toBeInTheDocument();
  });

  it("renders children when user has required permission", () => {
    vi.spyOn(authContext, "useAuth").mockReturnValue({
      user: {
        id: "1",
        email: "manager@kpc.co.ke",
        full_name: "Manager User",
        roles: ["manager"],
        permissions: ["resolve_anomalies", "view_anomaly_table"],
      },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      acceptTerms: vi.fn(),
      // termsRequired removed
    });

    render(
      <RequirePermission code="resolve_anomalies">
        <div>Protected Resolution Panel</div>
      </RequirePermission>
    );

    expect(screen.getByText("Protected Resolution Panel")).toBeInTheDocument();
    expect(screen.queryByText("Not authorized")).not.toBeInTheDocument();
  });
});