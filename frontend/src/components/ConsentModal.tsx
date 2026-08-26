"use client";

import { useEffect, useState } from "react";

interface ConsentModalProps {
  onAccept?: () => void;
  forceShow?: boolean;
}

export default function ConsentModal({ onAccept, forceShow = false }: ConsentModalProps) {
  const [open, setOpen] = useState<boolean>(false);

  useEffect(() => {
    if (forceShow) {
      setOpen(true);
    }
  }, [forceShow]);

  const handleAgree = () => {
    setOpen(false);
    if (onAccept) onAccept();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171310]/85 backdrop-blur-md p-4 sm:p-6">
      <div className="w-full max-w-2xl rounded-3xl bg-[#1f1b19] border border-[#33302c] p-6 sm:p-8 shadow-2xl space-y-6 text-[#f5f2ef]">
        <div className="flex items-center space-x-4 text-[#ec835a]">
          <div className="p-3.5 bg-[#b3312c]/15 rounded-2xl border border-[#b3312c]/30 shrink-0 text-[#b3312c] dark:text-[#ec835a]">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#f5f2ef] tracking-tight">Confidentiality & Non-Disclosure Notice</h2>
            <p className="text-xs sm:text-sm font-medium text-[#b2aeac] mt-1">Oil Revenue & Inuka Programme Data Governance Requirement</p>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#2a2725] border border-[#33302c] text-sm sm:text-base text-[#f5f2ef] space-y-3.5 leading-relaxed">
          <p className="font-medium">
            You are accessing two strictly separated assurance domains: confidential KPC Oil revenue records and protected Inuka beneficiary programme records. Access does not authorize cross-domain disclosure.
          </p>
          <ul className="list-disc pl-5 space-y-2 text-xs sm:text-sm text-[#b2aeac]">
            <li>Do not disclose unmasked commercial figures to unauthorized third parties.</li>
            <li>Inuka beneficiary and payment identifiers are masked in normal report views and exports by default.</li>
            <li>Oil and Inuka records remain separated by role, server-side scope, report filters, and export direction.</li>
            <li>Exported files are cryptographically signed with SHA-256 digests and logged to your user session.</li>
            <li>All activities comply with the Kenya Data Protection Act (KDPA) and KPC Security Guidelines.</li>
          </ul>
        </div>

        <div className="flex items-center justify-end pt-2">
          <button
            type="button"
            onClick={handleAgree}
            className="w-full py-3.5 px-6 bg-[#b3312c] hover:bg-[#962723] text-white font-bold text-base rounded-2xl transition-all shadow-xl shadow-[#b3312c]/25 flex items-center justify-center space-x-2.5 cursor-pointer"
          >
            <span>I Agree & Access Reports</span>
            <svg className="w-5 h-5 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
