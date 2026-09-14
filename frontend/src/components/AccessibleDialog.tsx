"use client";
import { useEffect, useRef } from "react";

/** Native modal dialog provides focus trapping, Escape dismissal and focus restoration. */
export default function AccessibleDialog({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-label={label} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/65">
    {children}
  </dialog>;
}
