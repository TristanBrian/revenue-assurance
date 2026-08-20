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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3 text-cyan-400">
            <div className="p-2 bg-cyan-500/10 rounded-xl border border-cyan-500/20">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Cryptographic Report Verifier</h2>
              <p className="text-xs text-slate-400">Verify file authenticity and tamper-evident SHA-256 signatures</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Upload box */}
        <div className="space-y-3">
          <label className="block text-xs font-medium text-slate-300">Select Exported Report File (.xlsx, .csv)</label>
          <input
            type="file"
            onChange={handleFileChange}
            accept=".xlsx,.csv"
            className="w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 cursor-pointer bg-slate-950/60 p-2 rounded-xl border border-slate-800"
          />
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            {error}
          </div>
        )}

        {result && (
          <div className={`p-4 rounded-xl border space-y-3 text-xs ${
            result.status === "VERIFIED"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
              : "bg-amber-500/10 border-amber-500/30 text-amber-200"
          }`}>
            <div className="flex items-center space-x-2 font-semibold">
              {result.status === "VERIFIED" ? (
                <>
                  <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-emerald-400">AUTHENTIC & VERIFIED REPORT</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-amber-400">UNKNOWN / UNVERIFIED FILE SIGNATURE</span>
                </>
              )}
            </div>

            <div className="space-y-1.5 font-mono text-[11px] bg-slate-950/60 p-3 rounded-lg border border-slate-800 text-slate-300">
              <div className="truncate"><span className="text-slate-500">SHA-256 Digest:</span> {result.file_hash}</div>
              <div className="truncate"><span className="text-slate-500">HMAC Signature:</span> {result.signature}</div>
            </div>

            {result.audit_match && (
              <div className="space-y-1 pt-1 border-t border-emerald-500/20 text-xs text-slate-300">
                <div className="font-medium text-slate-200">Audit Provenance Record Found:</div>
                <div>Export Timestamp: {new Date(result.audit_match.created_at).toLocaleString()}</div>
                <div>Exported Rows: {result.audit_match.rows_exported}</div>
                <div>Audit Log Ref: {result.audit_match.log_id}</div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end space-x-3 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-xl transition"
          >
            Close
          </button>
          <button
            type="button"
            disabled={!file || verifying}
            onClick={handleVerify}
            className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition flex items-center space-x-2"
          >
            {verifying ? (
              <span>Verifying Hash...</span>
            ) : (
              <>
                <span>Run Cryptographic Check</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
