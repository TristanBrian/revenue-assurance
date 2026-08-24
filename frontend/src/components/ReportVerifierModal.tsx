"use client";

import { useState } from "react";
import { verifyReportFile } from "@/lib/api";

interface ReportVerifierModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ReportVerifierModal({ isOpen, onClose }: ReportVerifierModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{
    status: "VERIFIED" | "UNKNOWN" | "ALTERED";
    filename: string;
    file_hash: string;
    signature: string;
    audit_match?: {
      log_id: string;
      created_at: string;
      report_type: string;
      rows_exported: number;
      contains_sensitive_omc_pii: boolean;
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResult(null);
      setError(null);
    }
  };

  const handleVerify = async () => {
    if (!file) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await verifyReportFile(file);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md p-6">
      <div className="w-full max-w-2xl rounded-3xl bg-card border border-border p-8 shadow-2xl space-y-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center space-x-4 text-primary">
            <div className="p-3 bg-primary/10 rounded-2xl border border-primary/20 shrink-0">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground tracking-tight">Cryptographic Report Verifier</h2>
              <p className="text-sm font-medium text-muted-foreground mt-1">Verify file authenticity and tamper-evident SHA-256 signatures</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Upload box */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-foreground">Select Exported Report File (.xlsx, .csv)</label>
          <input
            type="file"
            onChange={handleFileChange}
            accept=".xlsx,.csv"
            className="w-full text-sm text-foreground file:mr-4 file:py-2.5 file:px-5 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-muted file:text-foreground hover:file:bg-accent cursor-pointer bg-background p-3 rounded-2xl border border-border"
          />
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-status-critical-bg border border-status-critical/20 text-sm text-status-critical">
            {error}
          </div>
        )}

        {result && (
          <div className={`p-5 rounded-2xl border space-y-4 text-sm ${
            result.status === "VERIFIED"
              ? "bg-status-low-bg border-status-low/30 text-status-low"
              : "bg-status-medium-bg border-status-medium/30 text-status-medium"
          }`}>
            <div className="flex items-center space-x-3 font-semibold text-base">
              {result.status === "VERIFIED" ? (
                <>
                  <svg className="w-6 h-6 text-status-low" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-status-low">AUTHENTIC & VERIFIED REPORT</span>
                </>
              ) : (
                <>
                  <svg className="w-6 h-6 text-status-medium" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-status-medium">UNKNOWN / UNVERIFIED FILE SIGNATURE</span>
                </>
              )}
            </div>

            <div className="space-y-2 font-mono text-xs bg-background p-4 rounded-xl border border-border text-foreground">
              <div className="truncate"><span className="text-muted-foreground">SHA-256 Digest:</span> {result.file_hash}</div>
              <div className="truncate"><span className="text-muted-foreground">HMAC Signature:</span> {result.signature}</div>
            </div>

            {result.audit_match && (
              <div className="space-y-1.5 pt-2 border-t border-status-low/20 text-xs sm:text-sm text-foreground">
                <div className="font-semibold text-foreground">Audit Provenance Record Found:</div>
                <div>Export Timestamp: {new Date(result.audit_match.created_at).toLocaleString()}</div>
                <div>Exported Rows: {result.audit_match.rows_exported}</div>
                <div>Audit Log Ref: {result.audit_match.log_id}</div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end space-x-3 border-t border-border pt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 bg-muted hover:bg-accent text-foreground text-sm font-semibold rounded-2xl transition"
          >
            Close
          </button>
          <button
            type="button"
            disabled={!file || verifying}
            onClick={handleVerify}
            className="px-6 py-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white text-sm font-semibold rounded-2xl transition flex items-center space-x-2 shadow-lg shadow-primary/20"
          >
            {verifying ? (
              <span>Verifying Hash...</span>
            ) : (
              <>
                <span>Run Cryptographic Check</span>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>

  );
}
