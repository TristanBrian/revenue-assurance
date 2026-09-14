"use client";

import React, { useState, useEffect } from "react";
import { Upload, FileCheck, CheckCircle2, Link2, Lock } from "lucide-react";
import { verifyReportFile, getAuditVerify } from "@/lib/api";
import type { ReportVerificationResponse, AuditVerifyResponse } from "@/lib/types";

export default function CryptographicAuditTool() {
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<ReportVerificationResponse | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [auditData, setAuditData] = useState<AuditVerifyResponse | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingAudit(true);
    getAuditVerify()
      .then((res) => {
        if (!cancelled) setAuditData(res);
      })
      .catch(() => {
        if (!cancelled) setAuditData(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingAudit(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const dropped = e.dataTransfer.files[0];
      await processVerification(dropped);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      await processVerification(selected);
    }
  };

  const processVerification = async (fileToVerify: File) => {
    setVerifying(true);
    setVerifyError(null);
    setVerifyResult(null);

    try {
      const res = await verifyReportFile(fileToVerify);
      setVerifyResult(res);
    } catch (err: unknown) {
      setVerifyError(err instanceof Error ? err.message : "Verification unavailable. Please retry.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="p-6 rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-primary" />
            <h3 className="text-base font-bold text-foreground tracking-tight">
              Interactive Cryptographic Audit & Verification Tool
            </h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Check report fingerprints against recorded exports and inspect Base Sepolia audit verification
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Drag & Drop Verifier */}
        <div className="space-y-4">
          <div className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
            <FileCheck className="w-4 h-4 text-emerald-500" />
            Report SHA-256 Fingerprint Verifier
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className="border-2 border-dashed border-border/80 hover:border-primary/60 rounded-xl p-6 text-center transition-colors bg-background/40 flex flex-col items-center justify-center min-h-[160px] cursor-pointer"
          >
            <input
              type="file"
              id="report-upload-input"
              className="hidden"
              accept=".xlsx,.xls,.csv,.pdf"
              onChange={handleFileSelect}
            />

            <label htmlFor="report-upload-input" className="cursor-pointer flex flex-col items-center">
              <Upload className="w-8 h-8 text-muted-foreground mb-2" />
              <span className="text-sm font-semibold text-foreground mb-1">
                Drag & Drop Excel / CSV Report File
              </span>
              <span className="text-xs text-muted-foreground">
                Supports .xlsx, .csv, .pdf (computes SHA-256 digest instantly)
              </span>
            </label>
          </div>

          {verifying && (
            <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 text-xs text-primary flex items-center justify-center gap-2 animate-pulse">
              <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Computing SHA-256 checksum & verifying cryptographic signature...
            </div>
          )}

          {verifyError && <p role="alert" className="text-sm text-rose-500">Verification unavailable: {verifyError}</p>}

          {verifyResult && (
            <div
              className={`p-4 rounded-xl border ${
                verifyResult.status === "VERIFIED"
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/5 text-amber-400"
              } space-y-2 text-xs`}
            >
              <div className="flex items-center justify-between font-bold">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Report Status: {verifyResult.status}
                </span>
                <span className="font-mono text-[10px] bg-background/80 px-2 py-0.5 rounded">
                  {verifyResult.filename}
                </span>
              </div>

              <div className="font-mono text-[11px] break-all bg-background/50 p-2 rounded border border-border/40">
                <div>
                  <strong>SHA-256 Digest:</strong> {verifyResult.file_hash}
                </div>
                <div>
                  <strong>Signature:</strong> {verifyResult.signature}
                </div>
              </div>

              {verifyResult.audit_match && (
                <div className="pt-2 border-t border-border/30 text-[11px] text-muted-foreground flex justify-between">
                  <span>Match Export Log: #{verifyResult.audit_match.log_id}</span>
                  <span>Type: {verifyResult.audit_match.report_type}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Merkle Tree & On-Chain Anchor Visualizer */}
        <div className="space-y-4">
          <div className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Link2 className="w-4 h-4 text-blue-500" />
            Live Merkle Tree & Base Sepolia On-Chain Anchor
          </div>

          <div className="p-4 rounded-xl border border-border/60 bg-background/50 space-y-3 text-xs">
            {loadingAudit ? <p>Checking audit integrity…</p> : !auditData ? (
              <p role="status">Audit verification unavailable. Sign in with audit access and retry.</p>
            ) : (
              <>
                <p>Local hash chain: <strong>{auditData.local_chain.intact ? "Intact" : "Integrity failure"}</strong> ({auditData.local_chain.chain_length} records)</p>
                <p>Base Sepolia: <strong>{!auditData.on_chain_anchor.configured ? "Not configured" : !auditData.on_chain_anchor.checked ? "Not checked" : auditData.on_chain_anchor.matches === true ? "Anchor matches" : auditData.on_chain_anchor.matches === false ? "Anchor mismatch" : "Unconfirmed"}</strong></p>
                {auditData.on_chain_anchor.reason && <p>{auditData.on_chain_anchor.reason}</p>}
                {auditData.on_chain_anchor.tx_hash && (
                  <a className="text-primary underline break-all" href={`https://sepolia.basescan.org/tx/${auditData.on_chain_anchor.tx_hash}`} target="_blank" rel="noreferrer">View anchor transaction</a>
                )}
                <p>Sealed batches: {auditData.local_chain.batch_count ?? 0}; pending records: {auditData.local_chain.pending_rows ?? 0}</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
