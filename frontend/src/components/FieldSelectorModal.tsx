"use client";

import { useState } from "react";

interface FieldOption {
  key: string;
  label: string;
  category: "operational" | "sensitive";
}

const AVAILABLE_FIELDS: FieldOption[] = [
  { key: "dispatch_id", label: "Dispatch ID", category: "operational" },
  { key: "invoice_id", label: "Invoice ID", category: "operational" },
  { key: "product", label: "Product (PMS/AGO/DPK)", category: "operational" },
  { key: "depot", label: "Depot Location", category: "operational" },
  { key: "volume_liters", label: "Volume (Liters)", category: "operational" },
  { key: "value_kes", label: "Value (KES)", category: "operational" },
  { key: "break_type", label: "Leakage Break Type", category: "operational" },
  { key: "customer", label: "OMC / Customer Name", category: "sensitive" },
  { key: "kra_pin", label: "KRA PIN", category: "sensitive" },
  { key: "contact_email", label: "Contact Email", category: "sensitive" },
  { key: "phone", label: "Phone Number", category: "sensitive" },
  { key: "credit_limit_kes", label: "Credit Limit (KES)", category: "sensitive" },
];

interface FieldSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmExport: (selectedFields: string[]) => void;
  exporting: boolean;
}

export default function FieldSelectorModal({
  isOpen,
  onClose,
  onConfirmExport,
  exporting,
}: FieldSelectorModalProps) {
  const [selected, setSelected] = useState<string[]>(
    AVAILABLE_FIELDS.filter((f) => f.category === "operational").map((f) => f.key)
  );

  if (!isOpen) return null;

  const toggleField = (key: string) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const setPreset = (preset: "minimal" | "full") => {
    if (preset === "minimal") {
      setSelected(AVAILABLE_FIELDS.filter((f) => f.category === "operational").map((f) => f.key));
    } else {
      setSelected(AVAILABLE_FIELDS.map((f) => f.key));
    }
  };

  const hasSensitiveFields = selected.some((k) =>
    AVAILABLE_FIELDS.find((f) => f.key === k && f.category === "sensitive")
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-6">
      <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-slate-700/80 p-8 shadow-2xl space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Data Minimization Field Selector</h2>
            <p className="text-sm font-medium text-slate-400 mt-1">Select required fields for export in compliance with KDPA standards</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Presets */}
        <div className="flex items-center space-x-3 text-sm">
          <span className="text-slate-400 font-medium">Quick Presets:</span>
          <button
            type="button"
            onClick={() => setPreset("minimal")}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 transition text-xs font-semibold"
          >
            Minimal Operational (No PII)
          </button>
          <button
            type="button"
            onClick={() => setPreset("full")}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 transition text-xs font-semibold"
          >
            Full Audit Detail (With PII)
          </button>
        </div>

        {/* Options grid */}
        <div className="grid grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
          {AVAILABLE_FIELDS.map((field) => {
            const isChecked = selected.includes(field.key);
            const isSensitive = field.category === "sensitive";
            return (
              <label
                key={field.key}
                className={`flex items-center justify-between p-3.5 rounded-2xl border text-sm font-medium cursor-pointer transition ${
                  isChecked
                    ? "bg-slate-800/90 border-emerald-500/50 text-slate-100"
                    : "bg-slate-955/40 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleField(field.key)}
                    className="w-4 h-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500/20 bg-slate-900"
                  />
                  <span>{field.label}</span>
                </div>
                {isSensitive && (
                  <span className="px-2 py-0.5 text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-md">
                    PII
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {hasSensitiveFields && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs sm:text-sm text-amber-300 flex items-center space-x-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Notice: Selected export includes sensitive OMC commercial master data (PII). Export action will be logged in the audit trail.</span>
          </div>
        )}

        <div className="flex items-center justify-end space-x-3 border-t border-slate-800 pt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold rounded-2xl transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={exporting || selected.length === 0}
            onClick={() => onConfirmExport(selected)}
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-2xl transition flex items-center space-x-2 shadow-lg shadow-emerald-600/20"
          >
            {exporting ? (
              <span>Exporting...</span>
            ) : (
              <>
                <span>Download Filtered Excel ({selected.length} fields)</span>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>

  );
}
