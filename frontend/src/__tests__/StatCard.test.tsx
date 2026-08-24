import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import StatCard from "../components/StatCard";

describe("StatCard Component", () => {
  it("renders label and value correctly", () => {
    render(<StatCard label="Total Revenue" value="KES 4,500,000" />);
    expect(screen.getByText("Total Revenue")).toBeInTheDocument();
    expect(screen.getByText("KES 4,500,000")).toBeInTheDocument();
  });

  it("renders plain note text", () => {
    render(<StatCard label="Reconciliation Rate" value="98.5%" note="Target: >95%" />);
    expect(screen.getByText("Target: >95%")).toBeInTheDocument();
  });

  it("renders note pill when notePill prop is true", () => {
    render(<StatCard label="Leakage Detected" value="KES 120,000" note="+4.2% vs prior" notePill tone="critical" />);
    const pill = screen.getByText("+4.2% vs prior");
    expect(pill).toBeInTheDocument();
    expect(pill.className).toContain("rounded-full");
  });

  it("triggers onClick callback when clicked", () => {
    const handleClick = vi.fn();
    render(<StatCard label="Anomalies" value="12" onClick={handleClick} />);
    const cardButton = screen.getByRole("button");
    fireEvent.click(cardButton);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("renders progress bar when progress prop is provided", () => {
    const { container } = render(<StatCard label="E-Billing Sync" value="85%" progress={85} tone="info" />);
    const progressBar = container.querySelector(".transition-all");
    expect(progressBar).toBeInTheDocument();
    expect(progressBar?.outerHTML).toContain("width: 85%");
  });
});
