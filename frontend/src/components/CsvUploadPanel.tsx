"use client";

import { useState } from "react";
import { ApiError, downloadTemplate, reconcileUploadWithProgress, type TemplateType } from "@/lib/api";
import type { ReconcileResult } from "@/lib/types";

type UploadPhase = "idle" | "uploading" | "reconciling";

const FILE_FIELDS: { key: TemplateType; label: string; hint: string }[] = [
  { key: "dispatches", label: "Dispatches", hint: "Gantry waybills — dispatch_id, customer, volume, value" },
  { key: "invoices", label: "Invoices", hint: "Commercial invoices raised against dispatches" },
  { key: "payments", label: "Payments", hint: "OMC remittances against invoices" },
];

export default function CsvUploadPanel({
  materiality,
  onUploaded,
}: {
  materiality: number;
  onUploaded: (result: ReconcileResult) => void;
}) {
  const [files, setFiles] = useState<Partial<Record<TemplateType, File>>>({});
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const submitting = phase !== "idle";

  const allSelected = FILE_FIELDS.every((f) => files[f.key]);

  function handleFileChange(key: TemplateType, fileList: FileList | null) {
    setFiles((prev) => ({ ...prev, [key]: fileList?.[0] }));
  }

  async function handleTemplateDownload(key: TemplateType) {
    try {
      await downloadTemplate(key);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not download the template.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.dispatches || !files.invoices || !files.payments) return;

    setPhase("uploading");
    setUploadPercent(0);
    setError(null);
    try {
      const result = await reconcileUploadWithProgress(
        { dispatches: files.dispatches, invoices: files.invoices, payments: files.payments },
        materiality,
        (percent) => {
          setUploadPercent(percent);
          if (percent >= 100) setPhase("reconciling");
        },
      );
      onUploaded(result);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not reach the reconciliation API. Is the backend running?",
      );
    } finally {
      setPhase("idle");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {FILE_FIELDS.map((f) => {
          const selected = files[f.key];
          return (
            <div
              key={f.key}
              className={`rounded-lg border p-3 flex flex-col gap-2 transition-colors ${
                selected ? "border-status-low/40 bg-status-low-bg" : "border-border bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-base font-extrabold text-foreground">{f.label}</span>
                <button
                  type="button"
                  onClick={() => handleTemplateDownload(f.key)}
                  className="text-xs font-bold text-[#b3312c] dark:text-[#ec835a] underline hover:text-primary"
                >
                  template
                </button>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{f.hint}</p>
              <label className="mt-1 flex items-center justify-center rounded-md border border-dashed border-border bg-card py-3 px-4 text-xs sm:text-sm font-bold text-foreground bg-background hover:border-primary cursor-pointer transition-colors">
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => handleFileChange(f.key, e.target.files)}
                  className="hidden"
                />
                {selected ? (
                  <span className="text-status-low font-semibold truncate px-2">{selected.name}</span>
                ) : (
                  "Choose CSV file"
                )}
              </label>
            </div>
          );
        })}
      </div>

      <button
        type="submit"
        disabled={!allSelected || submitting}
        className="self-start rounded-md bg-primary px-4 py-2 text-base font-bold text-primary-foreground disabled:opacity-40 transition-all hover:bg-primary/90 shadow-md py-3 px-6 rounded-xl"
      >
        {phase === "uploading"
          ? `Uploading… ${uploadPercent}%`
          : phase === "reconciling"
            ? "Reconciling…"
            : "Upload & Reconcile"}
      </button>

      {phase !== "idle" && (
        <div className="flex flex-col gap-1 max-w-xs">
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            {phase === "uploading" ? (
              <div
                className="h-full rounded-full bg-primary transition-all duration-150 ease-out"
                style={{ width: `${uploadPercent}%` }}
              />
            ) : (
              // Reconciling has no real progress signal — POST /reconcile/upload
              // is one synchronous response, not a polled task like e-billing
              // sync — so this is an indeterminate sweep, not a fabricated %.
              <div className="h-full w-1/3 rounded-full bg-primary animate-indeterminate" />
            )}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {phase === "uploading"
              ? `Sending files: ${uploadPercent}%`
              : "Files received — running reconciliation on the server…"}
          </span>
        </div>
      )}

      {error && (
        <p className="text-sm text-status-critical bg-status-critical-bg border border-status-critical/20 rounded-lg p-3">
          {error}
        </p>
      )}
    </form>
  );
}
