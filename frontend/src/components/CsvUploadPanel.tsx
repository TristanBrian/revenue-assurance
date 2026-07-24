"use client";

import { useState } from "react";
import { ApiError, downloadTemplate, reconcileUpload, type TemplateType } from "@/lib/api";
import type { ReconcileResult } from "@/lib/types";

const FILE_FIELDS: { key: TemplateType; label: string }[] = [
  { key: "dispatches", label: "Dispatches" },
  { key: "invoices", label: "Invoices" },
  { key: "payments", label: "Payments" },
];

export default function CsvUploadPanel({
  materiality,
  onUploaded,
}: {
  materiality: number;
  onUploaded: (result: ReconcileResult) => void;
}) {
  const [files, setFiles] = useState<Partial<Record<TemplateType, File>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = FILE_FIELDS.every((f) => files[f.key]);

  function handleFileChange(key: TemplateType, fileList: FileList | null) {
    setFiles((prev) => ({ ...prev, [key]: fileList?.[0] }));
  }

  async function handleTemplateDownload(key: TemplateType) {
    try {
      await downloadTemplate(key);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not download the template.",
      );
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.dispatches || !files.invoices || !files.payments) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await reconcileUpload(
        {
          dispatches: files.dispatches,
          invoices: files.invoices,
          payments: files.payments,
        },
        materiality,
      );
      onUploaded(result);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the reconciliation API. Is the backend running?",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Test with your own CSVs
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Upload Dispatches, Invoices, and Payments CSVs to reconcile them instantly,
        without touching the database.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        {FILE_FIELDS.map((f) => (
          <div key={f.key} className="flex items-center gap-3 text-sm">
            <label className="w-24 shrink-0 text-zinc-600 dark:text-zinc-400">
              {f.label}
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => handleFileChange(f.key, e.target.files)}
              className="flex-1 text-xs text-zinc-600 file:mr-3 file:rounded file:border-0 file:bg-zinc-200 file:px-2 file:py-1 file:text-xs dark:text-zinc-400 dark:file:bg-zinc-800"
            />
            <button
              type="button"
              onClick={() => handleTemplateDownload(f.key)}
              className="shrink-0 text-xs text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              template
            </button>
          </div>
        ))}

        <button
          type="submit"
          disabled={!allSelected || submitting}
          className="mt-1 self-start rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {submitting ? "Reconciling…" : "Upload & Reconcile"}
        </button>
      </form>

      {error && (
        <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>
      )}
    </section>
  );
}
