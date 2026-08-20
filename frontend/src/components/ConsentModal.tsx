"use client";

import { useState, useEffect } from "react";

interface ConsentModalProps {
  onAccept: () => void;
}

const STORAGE_KEY = "kpc_report_confidentiality_accepted";

export default function ConsentModal({ onAccept }: ConsentModalProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const accepted = window.sessionStorage.getItem(STORAGE_KEY);
      if (!accepted) {
        setOpen(true);
      }
    }
  }, []);

  const handleAgree = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(STORAGE_KEY, "true");
    }
    setOpen(false);
    onAccept();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5">
        <div className="flex items-center space-x-3 text-amber-400">
          <div className="p-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Confidentiality & Non-Disclosure Notice</h2>
            <p className="text-xs text-slate-400">Order-to-Cash Data Governance Requirement</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300 space-y-3 leading-relaxed">
          <p>
            You are accessing sensitive KPC Revenue Assurance reports containing proprietary Oil Marketing Company (OMC) dispatch volumes, financial reconciliation figures, and e-billing audit trails.
          </p>
          <ul className="list-disc pl-4 space-y-1 text-slate-400">
            <li>Do not disclose unmasked commercial figures to unauthorized third parties.</li>
            <li>Exported files are cryptographically signed with SHA-256 digests and logged to your user session.</li>
            <li>All activities comply with the Kenya Data Protection Act (KDPA) and KPC Security Guidelines.</li>
          </ul>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            onClick={handleAgree}
            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm rounded-xl transition shadow-lg shadow-emerald-600/20 flex items-center justify-center space-x-2"
          >
            <span>I Agree & Access Reports</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
