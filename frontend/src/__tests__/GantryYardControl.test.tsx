import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import GantryYardControl from "../components/GantryYardControl";

globalThis.fetch = vi.fn();

describe("GantryYardControl Component (3D Depot Matrix QA Suite)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.prompt = vi.fn().mockReturnValue("KPC-MGR-9941");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "GATE_HOLD", data: { status: "GATE_HOLD" } }),
    });
  });

  it("renders the 3D Depot Control Plane header and loading bays", () => {
    render(<GantryYardControl />);

    expect(screen.getByText(/3D Depot Volumetric Matrix & Autonomous Control Plane/i)).toBeInTheDocument();
    expect(screen.getAllByText("Bay 01")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Bay 02")[0]).toBeInTheDocument();
    expect(screen.getAllByText("KDD 104B")[0]).toBeInTheDocument();
    expect(screen.getByText("3D Isometric")).toBeInTheDocument();
    expect(screen.getByText("2D Matrix")).toBeInTheDocument();
  });

  it("toggles between 3D Isometric and 2D Matrix view modes", () => {
    render(<GantryYardControl />);

    const button2D = screen.getByText("2D Matrix");
    fireEvent.click(button2D);
    expect(button2D.className).toContain("bg-cyan-500");

    const button3D = screen.getByText("3D Isometric");
    fireEvent.click(button3D);
    expect(button3D.className).toContain("bg-gradient-to-r");
  });

  it("opens the Inspector Modal when clicking a gantry bay", async () => {
    render(<GantryYardControl />);

    const inspectBtn = screen.getByText("🔍 Open Inspector Modal");
    fireEvent.click(inspectBtn);

    await waitFor(() => {
      expect(screen.getByText("Automated Hold Preview")).toBeInTheDocument();
      expect(screen.getByText("🔒 EXIT BLOCKED")).toBeInTheDocument();
    });
  });

  it("executes simulated 3D scan and updates audit log stream", async () => {
    render(<GantryYardControl />);

    const runPathBtn = screen.getByText(/Run 3D Path/i);
    fireEvent.click(runPathBtn);

    await waitFor(() => {
      expect(screen.getByText(/Real-Time Control Audit & Tax Log Stream/i)).toBeInTheDocument();
    });
  });

  it("supports manual manager override code entry", async () => {
    render(<GantryYardControl />);

    const inspectBtn = screen.getByText("🔍 Open Inspector Modal");
    fireEvent.click(inspectBtn);

    await waitFor(() => {
      expect(screen.getByText("Execute Manager Emergency Gate Override")).toBeInTheDocument();
    });

    const overrideBtn = screen.getByText("Execute Manager Emergency Gate Override");
    fireEvent.click(overrideBtn);

    expect(window.prompt).toHaveBeenCalled();
  });
});
