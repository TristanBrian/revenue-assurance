"use client";

/**
 * Outbound (stipend/disbursement) — Stage 2.
 *
 * Mirrors MaterialityContext.tsx's shape (localStorage-persisted state,
 * same provider/hook pattern), but the allowed value set and the initial
 * value both depend on the logged-in user's permissions/role, so this
 * reads useAuth() internally rather than staying framework-agnostic like
 * MaterialityContext does — a value here that the user isn't allowed to
 * see would just 403 on every request.
 *
 * Locking rules (see backend/scripts/seed_roles.py's ROLE_PERMISSIONS
 * comment for the backend-side rationale):
 * - No `view_outgoing_data` permission (Depot Supervisor, and anyone else
 *   without it) -> hard-locked to "inbound", toggle hidden. This is the
 *   ONLY thing actually preventing an inbound-only role from requesting
 *   outbound data — the backend doesn't reject direction=outbound for a
 *   role that lacks view_outgoing_data (see seed_roles.py's comment on
 *   why), so the frontend not offering it is what enforces the boundary
 *   in practice for that role.
 * - `inuka_manager` role -> hard-locked to "outbound", toggle hidden.
 * - Everyone else with view_outgoing_data (Manager, Revenue Assurance)
 *   -> free toggle between "inbound" / "outbound" / "all", default "all",
 *   persisted to localStorage like materiality is.
 */
import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { Direction } from "@/lib/api";

interface DirectionContextType {
  direction: Direction;
  setDirection: (value: Direction) => void;
  /** False for Depot Supervisor (locked to inbound) and Inuka Manager
   * (locked to outbound) — nav/pages should hide the toggle UI entirely
   * rather than show it disabled. */
  canToggle: boolean;
}

const DirectionContext = createContext<DirectionContextType | undefined>(undefined);

const STORAGE_KEY = "kpc_direction_filter";

export function DirectionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [direction, setDirectionState] = useState<Direction>("all");

  const canSeeOutgoing = !!user?.permissions.includes("view_outgoing_data");
  const isInukaManager = !!user?.roles.includes("inuka_manager");
  const canToggle = canSeeOutgoing && !isInukaManager;

  // Reconcile the locked-role cases whenever the user loads/changes —
  // deliberately NOT reading localStorage for these two, so a Depot
  // Supervisor or Inuka Manager account can never end up requesting a
  // direction it doesn't have permission for just because a previous
  // session (or a shared browser profile) had a different value saved.
  useEffect(() => {
    if (!user) return;
    // Deferred a microtask so the setState calls below never land
    // synchronously inside the effect body — same react-hooks/
    // set-state-in-effect deferral pattern used in
    // app/dashboard/anomalies/page.tsx's loadAnomalies() effect.
    Promise.resolve().then(() => {
      if (!canSeeOutgoing) {
        setDirectionState("inbound");
        return;
      }
      if (isInukaManager) {
        setDirectionState("outbound");
        return;
      }
      const saved = localStorage.getItem(STORAGE_KEY) as Direction | null;
      if (saved === "inbound" || saved === "outbound" || saved === "all") {
        setDirectionState(saved);
      }
    });
  }, [user, canSeeOutgoing, isInukaManager]);

  const setDirection = (value: Direction) => {
    if (!canToggle) return; // locked roles can't change it via the API either
    setDirectionState(value);
    localStorage.setItem(STORAGE_KEY, value);
  };

  return (
    <DirectionContext.Provider value={{ direction, setDirection, canToggle }}>
      {children}
    </DirectionContext.Provider>
  );
}

export function useDirection() {
  const context = useContext(DirectionContext);
  if (!context) {
    throw new Error("useDirection must be used within a DirectionProvider");
  }
  return context;
}
