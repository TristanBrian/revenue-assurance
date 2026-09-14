import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import CsvUploadPanel from "../components/CsvUploadPanel";
import { downloadTemplate, reconcileUploadWithProgress } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual("../lib/api");
  return {
    ...actual,
    downloadTemplate: vi.fn().mockResolvedValue(undefined),
    reconcileUploadWithProgress: vi.fn(),
  };
});

describe("CsvUploadPanel Component", () => {
  const mockOnUploaded = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 3 file drop zones and disabled submit button when empty", () => {
    render(<CsvUploadPanel materiality={100000} onUploaded={mockOnUploaded} />);

    expect(screen.getByText("Dispatches")).toBeInTheDocument();
    expect(screen.getByText("Invoices")).toBeInTheDocument();
    expect(screen.getByText("Payments")).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: /Upload & Reconcile/i });
    expect(submitBtn).toBeDisabled();
  });

  it("triggers downloadTemplate when template button is clicked", async () => {
    render(<CsvUploadPanel materiality={100000} onUploaded={mockOnUploaded} />);

    const templateBtns = screen.getAllByRole("button", { name: /template/i });
    expect(templateBtns.length).toBe(3);

    fireEvent.click(templateBtns[0]);

    await waitFor(() => {
      expect(downloadTemplate).toHaveBeenCalledWith("dispatches");
    });
  });

  it("enables submit button when all 3 files are selected and calls reconcileUploadWithProgress", async () => {
    const mockResult = { metrics: {}, anomalies: [] };
    vi.mocked(reconcileUploadWithProgress).mockImplementation(async (_files, _mat, onProgress) => {
      if (onProgress) onProgress(100);
      return mockResult as any;
    });

    const { container } = render(<CsvUploadPanel materiality={100000} onUploaded={mockOnUploaded} />);

    const fileInputs = container.querySelectorAll("input[type='file']");
    expect(fileInputs.length).toBe(3);

    const f1 = new File(["disp"], "dispatches.csv", { type: "text/csv" });
    const f2 = new File(["inv"], "invoices.csv", { type: "text/csv" });
    const f3 = new File(["pay"], "payments.csv", { type: "text/csv" });

    fireEvent.change(fileInputs[0], { target: { files: [f1] } });
    fireEvent.change(fileInputs[1], { target: { files: [f2] } });
    fireEvent.change(fileInputs[2], { target: { files: [f3] } });

    const submitBtn = screen.getByRole("button", { name: /Upload & Reconcile/i });
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(reconcileUploadWithProgress).toHaveBeenCalledWith(
        { dispatches: f1, invoices: f2, payments: f3 },
        100000,
        expect.any(Function)
      );
      expect(mockOnUploaded).toHaveBeenCalledWith(mockResult);
    });
  });
});
