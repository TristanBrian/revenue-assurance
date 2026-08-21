"use client";

import { useState, useEffect } from "react";

interface ConsentModalProps {
  onAccept: () => void;
}

const STORAGE_KEY = "kpc_report_confidentiality_accepted";

export default function ConsentModal({ onAccept }: ConsentModalProps) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const accepted = window.sessionStorage.getItem(STORAGE_KEY);
      return !accepted;
    }
    return false;
  });


  const handleAgree = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(STORAGE_KEY, "true");
    }
    setOpen(false);
    onAccept();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-6">
      <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-slate-700/80 p-8 shadow-2xl space-y-7">
        <div className="flex items-center space-x-4 text-amber-400">
          <div className="p-3.5 bg-amber-500/10 rounded-2xl border border-amber-500/20 shrink-0">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Confidentiality & Non-Disclosure Notice</h2>
            <p className="text-sm font-medium text-slate-400 mt-1">Order-to-Cash Data Governance Requirement</p>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-slate-955/80 border border-slate-800 text-base text-slate-200 space-y-4 leading-relaxed">
          <p className="font-medium text-slate-100">
            You are accessing sensitive KPC Revenue Assurance reports containing proprietary Oil Marketing Company (OMC) dispatch volumes, financial reconciliation figures, and e-billing audit trails.
          </p>
          <ul className="list-disc pl-5 space-y-2.5 text-sm sm:text-base text-slate-300">
            <li>Do not disclose unmasked commercial figures to unauthorized third parties.</li>
            <li>Exported files are cryptographically signed with SHA-256 digests and logged to your user session.</li>
            <li>All activities comply with the Kenya Data Protection Act (KDPA) and KPC Security Guidelines.</li>
          </ul>
        </div>

        <div className="flex items-center justify-end pt-2">
          <button
            onClick={handleAgree}
            className="w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-base sm:text-lg rounded-2xl transition-all shadow-xl shadow-emerald-600/25 flex items-center justify-center space-x-3 cursor-pointer"
          >
            <span>I Agree & Access Reports</span>
            <svg className="w-6 h-6 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>

  );
}
