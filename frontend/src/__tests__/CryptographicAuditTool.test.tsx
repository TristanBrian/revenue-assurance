import React from "react";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CryptographicAuditTool from "@/components/CryptographicAuditTool";
import { getAuditVerify, verifyReportFile } from "@/lib/api";

vi.mock("@/lib/api", () => ({ getAuditVerify: vi.fn(), verifyReportFile: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuditVerify).mockRejectedValue(new Error("Offline"));
});
test("never reports verification or blockchain success when APIs fail", async () => {
  vi.mocked(verifyReportFile).mockRejectedValue(new Error("Offline"));
  const { container } = render(<CryptographicAuditTool />);
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["untrusted"], "report.csv", { type: "text/csv" })] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Verification unavailable");
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Audit verification unavailable"));
  expect(screen.queryByText(/Report Status: VERIFIED/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Anchor matches/)).not.toBeInTheDocument();
  expect(container.querySelector('a[href*="basescan"]')).toBeNull();
});
test("renders an unknown report as unknown", async () => {
  vi.mocked(verifyReportFile).mockResolvedValue({ status: "UNKNOWN", filename: "new.csv", file_hash: "abc", signature: "digest" });
  const { container } = render(<CryptographicAuditTool />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["data"], "new.csv")] } });
  expect(await screen.findByText("Report Status: UNKNOWN")).toBeInTheDocument();
  expect(screen.queryByText(/Report Status: VERIFIED/)).not.toBeInTheDocument();
});
