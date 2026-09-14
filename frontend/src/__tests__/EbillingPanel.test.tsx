import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import EbillingPanel from "../components/EbillingPanel";
import {
  getEbillingStatus,
  getEbillingMonitor,
  getEbillingLogs,
  startEbillingSync,
} from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual("../lib/api");
  return {
    ...actual,
    getEbillingStatus: vi.fn(),
    getEbillingMonitor: vi.fn(),
    getEbillingLogs: vi.fn(),
    startEbillingSync: vi.fn(),
    retryEbillingInvoice: vi.fn(),
    sendEbillingWebhook: vi.fn(),
    getEbillingTask: vi.fn(),
  };
});

describe("EbillingPanel Component", () => {
  const mockStatus = {
    system: "KRA iCMS E-Billing Gateway",
    connected: true,
    last_sync: "2026-08-15T12:00:00Z",
    total_invoices: 100,
    synced_count: 90,
    pending_count: 5,
    failed_count: 5,
    not_attempted: 0,
    api_endpoint: "https://icms.kra.go.ke/api/v1",
    response_time_ms: 120,
  };

  const mockMonitor = {
    failure_rate: 0.05,
    alert: false,
    threshold: 0.15,
    message: "Failure rate (5.0%) is within nominal parameters.",
  };

  const mockLogs = [
    {
      invoice_id: "INV-001",
      status: "synced",
      sync_date: "2026-08-15T12:00:00Z",
      error_message: null,
      retry_count: 0,
      last_attempt: "2026-08-15T12:00:00Z",
      customer_name: "TotalEnergies",
      value_kes: 1500000,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEbillingStatus).mockResolvedValue(mockStatus as Awaited<ReturnType<typeof getEbillingStatus>>);
    vi.mocked(getEbillingMonitor).mockResolvedValue(mockMonitor as Awaited<ReturnType<typeof getEbillingMonitor>>);
    vi.mocked(getEbillingLogs).mockResolvedValue(mockLogs as Awaited<ReturnType<typeof getEbillingLogs>>);
  });

  it("renders status cards and logs table after fetching data", async () => {
    render(<EbillingPanel />);

    await waitFor(() => {
      expect(screen.getByText(/KRA iCMS E-Billing Gateway/i)).toBeInTheDocument();
    });

    expect(screen.getByText("INV-001")).toBeInTheDocument();
    expect(screen.getByText("TotalEnergies")).toBeInTheDocument();
  });

  it("triggers startEbillingSync when sync button is clicked", async () => {
    vi.mocked(startEbillingSync).mockResolvedValue({ task_id: "task-999" });

    render(<EbillingPanel />);

    await waitFor(() => {
      expect(screen.getByText(/KRA iCMS E-Billing Gateway/i)).toBeInTheDocument();
    });

    const syncBtn = screen.getByRole("button", { name: /Sync Pending Invoices/i });
    fireEvent.click(syncBtn);

    await waitFor(() => {
      expect(startEbillingSync).toHaveBeenCalled();
    });
  });
});
