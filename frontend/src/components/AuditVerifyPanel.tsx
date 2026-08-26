"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ApiError, getAuditVerify, type AuditVerifyResult } from "@/lib/api";

// Base Sepolia's block explorer — matches anchor_service.py's NETWORK
// ("base-sepolia") / CHAIN_ID (84532).
const BASESCAN_TX_URL = "https://sepolia.basescan.org/tx/";

function StatusPill({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
        {label}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        ok
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-red-500/10 text-red-600 dark:text-red-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`} />
      {label}
    </span>
  );
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(new Date(value), "yyyy-MM-dd HH:mm:ss");
  } catch {
    return value;
  }
}

function truncateHash(hash: string | null | undefined, lead = 10, tail = 8): string {
  if (!hash) return "—";
  if (hash.length <= lead + tail + 3) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

/**
 * Two independent results, rendered as two independent cards — never
 * collapsed into one pass/fail — matching GET /api/audit/verify's own
 * design intent (see backend/app/services/audit/anchor_service.py's
 * verify_on_chain_anchor() docstring): "a demo showing 'local chain
 * intact' and 'on-chain anchor confirmed' as two independent green
 * checks (and exactly which one breaks, and where) is the actual point
 * of anchoring at all."
 */
export default function AuditVerifyPanel() {
  const [result, setResult] = useState<AuditVerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  async function runVerify() {
    setLoading(true);
    setError(null);
    try {
      const data = await getAuditVerify();
      setResult(data);
      setCheckedAt(new Date());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify the audit trail.");
    } finally {
      setLoading(false);
    }
  }

  const local = result?.local_chain;
  const anchor = result?.on_chain_anchor;
  const brokenBatches = local?.batch_results.filter((b) => !b.intact) ?? [];

  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground opacity-0 select-none">Verify</span>
        <button
          onClick={runVerify}
          disabled={loading}
          className="px-4 py-1.5 text-sm font-semibold bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Verifying…" : "Verify Audit Trail"}
        </button>
      </div>

      {(result || error) && (
        <div className="w-full flex flex-col gap-3">
          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {result && local && anchor && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Local chain integrity — the check that catches direct DB tampering. */}
              <div className="bg-background border border-border rounded-lg p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">Local Chain Integrity</h3>
                  <StatusPill ok={local.intact} label={local.intact ? "Intact" : "Broken"} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground uppercase font-semibold">Rows</p>
                    <p className="font-mono font-semibold text-foreground">{local.chain_length.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground uppercase font-semibold">Batches</p>
                    <p className="font-mono font-semibold text-foreground">{local.batch_count}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground uppercase font-semibold">Tip Block</p>
                    <p className="font-mono font-semibold text-foreground">{local.tip_block_index}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground uppercase font-semibold">Pending (unsealed)</p>
                    <p className="font-mono font-semibold text-foreground">{local.pending_rows}</p>
                  </div>
                </div>

                {!local.intact && (
                  <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md p-3 text-xs text-red-600 dark:text-red-400">
                    <p className="font-semibold">{local.reason}</p>
                    {local.broken_at_block_index !== null && (
                      <p className="mt-0.5">Broken at block_index {local.broken_at_block_index}</p>
                    )}
                    {local.broken_at_batch_index !== null && (
                      <p className="mt-0.5">Broken at batch_index {local.broken_at_batch_index}</p>
                    )}
                  </div>
                )}

                {brokenBatches.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                      {brokenBatches.length} of {local.batch_count} batches broken
                    </p>
                    <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
                      {brokenBatches.map((b) => (
                        <div
                          key={b.batch_index}
                          className="text-xs font-mono bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 rounded px-2 py-1"
                        >
                          batch {b.batch_index}: {b.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    All {local.batch_count} sealed batches recompute intact
                    {local.legacy_row_count > 0 ? ` (+${local.legacy_row_count} legacy rows)` : ""}.
                  </p>
                )}
              </div>

              {/* On-chain anchor — the check nobody with DB access alone can defeat. */}
              <div className="bg-background border border-border rounded-lg p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">On-Chain Anchor (Base Sepolia)</h3>
                  <StatusPill
                    ok={anchor.checked ? anchor.matches : null}
                    label={
                      !anchor.configured
                        ? "Not configured"
                        : !anchor.checked
                          ? "Not yet anchored"
                          : anchor.matches
                            ? "Confirmed"
                            : "Mismatch"
                    }
                  />
                </div>

                {!anchor.configured && (
                  <p className="text-xs text-muted-foreground">
                    On-chain anchoring isn&apos;t configured for this deployment (no contract address or CDP
                    credentials set) — the local chain check above is still fully valid on its own.
                  </p>
                )}

                {anchor.configured && !anchor.checked && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3 text-xs text-amber-700 dark:text-amber-400">
                    {anchor.reason ?? "No anchor has been recorded yet."}
                  </div>
                )}

                {anchor.checked && (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground uppercase font-semibold">Anchor Version</p>
                        <p className="font-mono font-semibold text-foreground uppercase">{anchor.anchor_version ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground uppercase font-semibold">Anchored At</p>
                        <p className="font-mono font-semibold text-foreground">{formatTimestamp(anchor.anchored_at)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground uppercase font-semibold">Base Block</p>
                        <p className="font-mono font-semibold text-foreground">{anchor.base_block_number ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground uppercase font-semibold">Anchored Index</p>
                        <p className="font-mono font-semibold text-foreground">
                          {anchor.anchor_batch_index ?? anchor.anchor_block_index ?? "—"}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase font-semibold mb-1">Transaction</p>
                      {anchor.tx_hash ? (
                        <a
                          href={`${BASESCAN_TX_URL}${anchor.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-mono text-xs text-primary hover:underline break-all"
                        >
                          {truncateHash(anchor.tx_hash)}
                          <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      ) : (
                        <p className="text-xs text-muted-foreground">—</p>
                      )}
                    </div>

                    {!anchor.matches && anchor.reason && (
                      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md p-3 text-xs text-red-600 dark:text-red-400">
                        {anchor.reason}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {checkedAt && (
            <p className="text-[11px] text-muted-foreground">Last checked {format(checkedAt, "yyyy-MM-dd HH:mm:ss")}</p>
          )}
        </div>
      )}
    </>
  );
}
