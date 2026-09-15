"use client";

import { useState } from "react";

/** Small first-party support control styled with the KPC application shell. */
export default function KpcSupportWidget() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <div
          role="dialog"
          aria-label="KPC support"
          className="w-72 rounded-2xl border border-[#1b3553] bg-[#071a33] p-4 text-white shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8fb6d8]">KPC support</p>
              <h2 className="mt-1 text-sm font-bold">Need help with FlowGuard?</h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close KPC support"
              className="rounded-md p-1 text-[#b9cce0] hover:bg-[#143b59] hover:text-white"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[#b9cce0]">
            Contact your KPC assurance administrator for access, report, or investigation support.
          </p>
          <a
            href="mailto:assurance@kpc.co.ke"
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-[#b3312c] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#962723]"
          >
            Contact assurance support
          </a>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Open KPC support"
        className="flex items-center gap-2 rounded-full bg-[#b3312c] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#071a33]/25 transition hover:bg-[#962723]"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/50 bg-[#071a33] text-[10px] font-black">KPC</span>
        <span>Support</span>
      </button>
    </div>
  );
}
