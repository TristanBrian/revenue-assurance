import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import AnomaliesTable from "../components/AnomaliesTable";
import { getAnomalies, downloadExport } from "../lib/api";
import { anomaliesConfig } from "../config/direction-config";

vi.mock("../lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      id: "usr-001",
      email: "assurances@kpc.co.ke",
      roles: ["revenue_assurance"],
      permissions: ["view_anomaly_table", "export_reports", "resolve_anomaly"],
    },
  }),
}));

vi.mock("../context/MaterialityContext", () => ({
  useMateriality: () => ({ materiality: 100000, setMateriality: vi.fn() }),
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual("../lib/api");
  return {
    ...actual,
    getAnomalies: vi.fn(),
    downloadExport: vi.fn(),
    getAnomalyActions: vi.fn().mockResolvedValue([]),
    updateAnomalyStatus: vi.fn().mockResolvedValue({ status: "success" }),
  };
});

describe("AnomaliesTable Component", () => {
  const mockAnomaliesResult = {
    anomalies: [
      {
        dispatch_id: "DISP-001",
        invoice_id: "INV-001",
        customer: "TotalEnergies",
        product: "Diesel",
        depot: "Nairobi Depot",
        dispatched_kes: 1500000,
        invoiced_kes: 1500000,
        paid_kes: 1300000,
        leakage_kes: 200000,
        break_type: "Underpayment",
        status: "Pending",
        ebilling_status: "pending",
        ebilling_sync_date: null,
        age_days: 12,
        created_at: "2026-08-01T10:00:00Z",
      },
    ],
    pagination: {
      page: 1,
      page_size: 25,
      total: 1,
      total_pages: 1,
      has_next: false,
      has_prev: false,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAnomalies).mockResolvedValue(mockAnomaliesResult as Awaited<ReturnType<typeof getAnomalies>>);
  });

  it("renders search input, filter selects, and multi-format export buttons", async () => {
    render(
      <AnomaliesTable
        direction="inbound"
        config={anomaliesConfig.inbound}
        title="Test Anomalies Title"
      />
    );

    expect(screen.getByText("Test Anomalies Title")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("TotalEnergies")).toBeInTheDocument();
    });

    expect(screen.getByText("Excel (.xlsx)")).toBeInTheDocument();
    expect(screen.getByText("CSV (.csv)")).toBeInTheDocument();
    expect(screen.getByText("JSON (.json)")).toBeInTheDocument();
  });

  it("triggers downloadExport when Excel export button is clicked", async () => {
    render(
      <AnomaliesTable
        direction="inbound"
        config={anomaliesConfig.inbound}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("TotalEnergies")).toBeInTheDocument();
    });

    const excelBtn = screen.getByText("Excel (.xlsx)");
    fireEvent.click(excelBtn);

    await waitFor(() => {
      expect(downloadExport).toHaveBeenCalledWith(100000, "inbound", "xlsx", expect.any(Object));
    });
  });

  it("triggers getAnomalies with search term when typed into search input", async () => {
    render(
      <AnomaliesTable
        direction="inbound"
        config={anomaliesConfig.inbound}
      />
    );

    const searchInput = screen.getByPlaceholderText(/Search by/i);
    fireEvent.change(searchInput, { target: { value: "Total" } });

    await waitFor(() => {
      expect(getAnomalies).toHaveBeenCalledWith(
        100000,
        1,
        25,
        expect.objectContaining({ search: "Total" }),
        "inbound"
      );
    });
  });
});
