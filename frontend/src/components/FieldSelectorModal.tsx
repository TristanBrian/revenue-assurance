"use client";

import { useState } from "react";

export interface FieldOption {
  key: string;
  label: string;
  category: "operational" | "sensitive";
  domain: "kpc" | "inuka" | "all";
}

const AVAILABLE_FIELDS: FieldOption[] = [
  // KPC Oil Side Fields
  { key: "dispatch_id", label: "Dispatch Waybill ID", category: "operational", domain: "kpc" },
  { key: "invoice_id", label: "SAP Invoice ID", category: "operational", domain: "kpc" },
  { key: "product", label: "Petroleum Product (PMS/AGO/DPK)", category: "operational", domain: "kpc" },
  { key: "depot", label: "KPC Depot Location", category: "operational", domain: "kpc" },
  { key: "volume_liters", label: "Dispatched Volume (Liters)", category: "operational", domain: "kpc" },
  { key: "value_kes", label: "Order Value (KES)", category: "operational", domain: "kpc" },
  { key: "break_type", label: "Reconciliation Anomaly Type", category: "operational", domain: "kpc" },
  { key: "customer", label: "OMC / Commercial Customer", category: "sensitive", domain: "kpc" },
  { key: "kra_pin", label: "Tax KRA PIN", category: "sensitive", domain: "kpc" },
  { key: "contact_email", label: "OMC Contact Email", category: "sensitive", domain: "kpc" },
  { key: "phone", label: "Gantry Phone Number", category: "sensitive", domain: "kpc" },

  // Inuka Fellowship Side Fields
  { key: "case_id", label: "Assurance Case ID", category: "operational", domain: "inuka" },
  { key: "pillar_id", label: "Inuka Program Pillar", category: "operational", domain: "inuka" },
  { key: "attendance_rate", label: "Fellowship Attendance %", category: "operational", domain: "inuka" },
  { key: "stipend_kes", label: "Stipend Amount (KES)", category: "operational", domain: "inuka" },
  { key: "disbursement_status", label: "Payment Status", category: "operational", domain: "inuka" },
  { key: "beneficiary_name", label: "Fellow / Beneficiary Name", category: "sensitive", domain: "inuka" },
  { key: "id_number", label: "National ID Number", category: "sensitive", domain: "inuka" },
  { key: "officer_id", label: "Assurance Officer ID", category: "sensitive", domain: "inuka" },
  { key: "mpesa_phone", label: "Disbursement Phone / MPESA", category: "sensitive", domain: "inuka" },
  { key: "mpesa_ref", label: "MPESA Receipt Reference", category: "sensitive", domain: "inuka" },
];

interface FieldSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmExport: (selectedFields: string[], maskSensitive: boolean) => void;
  exporting: boolean;
  domain?: "kpc" | "inuka";
}

export default function FieldSelectorModal({
  isOpen,
  onClose,
  onConfirmExport,
  exporting,
  domain = "kpc",
}: FieldSelectorModalProps) {
  const fieldsForDomain = AVAILABLE_FIELDS.filter((f) => f.domain === domain || f.domain === "all");
  
  const [selected, setSelected] = useState<string[]>(() =>
    fieldsForDomain.filter((f) => f.category === "operational").map((f) => f.key)
  );

  const [maskSensitive, setMaskSensitive] = useState<boolean>(true);

  if (!isOpen) return null;

  const toggleField = (key: string) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const setPreset = (preset: "minimal" | "full") => {
    if (preset === "minimal") {
      setSelected(fieldsForDomain.filter((f) => f.category === "operational").map((f) => f.key));
    } else {
      setSelected(fieldsForDomain.map((f) => f.key));
    }
  };

  const hasSensitiveFields = selected.some((k) =>
    fieldsForDomain.find((f) => f.key === k && f.category === "sensitive")
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171310]/85 backdrop-blur-md p-4 sm:p-6 text-[#f5f2ef]">
      <div className="w-full max-w-2xl rounded-3xl bg-[#1f1b19] border border-[#33302c] p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="flex items-center justify-between border-b border-[#33302c] pb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#f5f2ef] tracking-tight">
              Data Minimization Field Selector ({domain === "kpc" ? "KPC Cash-to-Order" : "Inuka Fellowship"})
            </h2>
            <p className="text-xs sm:text-sm font-medium text-[#b2aeac] mt-1">
              Filter fields and star-mask sensitive PII before generating report file (KDPA Compliant)
            </p>
          </div>
          <button onClick={onClose} className="text-[#b2aeac] hover:text-[#f5f2ef] p-1">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Presets */}
        <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
          <span className="text-[#b2aeac] font-medium">Presets:</span>
          <button
            type="button"
            onClick={() => setPreset("minimal")}
            className="px-3.5 py-1.5 bg-[#2a2725] hover:bg-[#33302c] text-[#f5f2ef] rounded-xl border border-[#33302c] transition font-semibold"
          >
            Minimal Operational (No PII)
          </button>
          <button
            type="button"
            onClick={() => setPreset("full")}
            className="px-3.5 py-1.5 bg-[#2a2725] hover:bg-[#33302c] text-[#f5f2ef] rounded-xl border border-[#33302c] transition font-semibold"
          >
            Full Audit Detail (Include PII)
          </button>
        </div>

        {/* Masking option toggle */}
        <div className="p-4 rounded-2xl bg-[#2a2725] border border-[#33302c] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <input
              id="maskToggle"
              type="checkbox"
              checked={maskSensitive}
              onChange={(e) => setMaskSensitive(e.target.checked)}
              className="w-4 h-4 rounded border-[#33302c] text-[#b3312c] focus:ring-[#b3312c]/20 bg-[#1f1b19]"
            />
            <label htmlFor="maskToggle" className="text-xs sm:text-sm font-semibold text-[#f5f2ef] cursor-pointer">
              Star-mask sensitive PII columns (e.g. <span className="font-mono text-[#ec835a]">KRA-***-99</span>, <span className="font-mono text-[#ec835a]">+254-7***-123</span>)
            </label>
          </div>
          <span className="text-[10px] font-extrabold uppercase px-2 py-1 rounded bg-[#0ca30c]/20 text-[#0ca30c] border border-[#0ca30c]/30">
            KDPA Safe
          </span>
        </div>

        {/* Options grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
          {fieldsForDomain.map((field) => {
            const isChecked = selected.includes(field.key);
            const isSensitive = field.category === "sensitive";
            return (
              <label
                key={field.key}
                className={`flex items-center justify-between p-3.5 rounded-2xl border text-xs sm:text-sm font-medium cursor-pointer transition ${
                  isChecked
                    ? "bg-[#2a2725] border-[#b3312c]/60 text-[#f5f2ef]"
                    : "bg-[#1f1b19] border-[#33302c] text-[#b2aeac] hover:border-[#b3312c]/30"
                }`}
              >
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleField(field.key)}
                    className="w-4 h-4 rounded border-[#33302c] text-[#b3312c] focus:ring-[#b3312c]/20 bg-[#1f1b19]"
                  />
                  <span>{field.label}</span>
                </div>
                {isSensitive && (
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-[#b6790a]/20 text-[#ec835a] border border-[#b6790a]/30 rounded-md">
                    PII
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {hasSensitiveFields && (
          <div className="p-4 bg-[#b6790a]/15 border border-[#b6790a]/30 rounded-2xl text-xs text-[#ec835a] flex items-center space-x-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Notice: Export includes commercial/fellow PII fields. Activity will be cryptographically signed (SHA-256) and logged.</span>
          </div>
        )}

        <div className="flex items-center justify-end space-x-3 border-t border-[#33302c] pt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 bg-[#2a2725] hover:bg-[#33302c] text-[#f5f2ef] text-sm font-semibold rounded-2xl transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={exporting || selected.length === 0}
            onClick={() => onConfirmExport(selected, maskSensitive)}
            className="px-6 py-3 bg-[#b3312c] hover:bg-[#962723] disabled:opacity-50 text-white text-sm font-bold rounded-2xl transition flex items-center space-x-2 shadow-lg shadow-[#b3312c]/20"
          >
            {exporting ? (
              <span>Generating Report...</span>
            ) : (
              <>
                <span>Download Report ({selected.length} fields)</span>
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
