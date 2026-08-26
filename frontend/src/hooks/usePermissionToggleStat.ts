"use client";

import { useAuth } from "@/lib/auth-context";
import type { OverviewStatData } from "@/config/direction-config";
import type { StatTone } from "@/components/StatCard";

export interface StatCardSlotConfig {
  label: string;
  note?: string;
  href?: string;
  notePill?: boolean;
  progress?: (data: OverviewStatData) => number | undefined;
  tone?: (data: OverviewStatData) => StatTone | undefined;
  getValue: (data: OverviewStatData) => string;
}

/** A stat card slot whose content depends on whether the current user
 * holds `permission` — `permission: null` means "always whenTrue" (used
 * for the two StatCardGrid slots that don't actually toggle on a given
 * direction, so every slot still goes through this same hook uniformly
 * rather than branching component structure per direction). */
export interface PermissionToggleStatConfig {
  permission: string | null;
  whenTrue: StatCardSlotConfig;
  whenFalse: StatCardSlotConfig;
}

/** Resolves one stat card slot's config based on whether the current user
 * holds `config.permission` — the toggle mechanism dashboard/page.tsx used
 * to hardcode inline (Total Leakage vs Total Dispatched, High Risk OMCs vs
 * Total Paid Remitted). Reused as-is by both overviewConfig.inbound and
 * overviewConfig.outbound slots via StatCardGrid, which always calls this
 * the same number of times regardless of direction (hook-call-order rule) —
 * see StatCardSlotConfig's `permission: null` case for slots that don't
 * really toggle on a given side. */
export function usePermissionToggleStat(config: PermissionToggleStatConfig): StatCardSlotConfig {
  const { user } = useAuth();
  const hasPermission = config.permission === null || (user?.permissions.includes(config.permission) ?? false);
  return hasPermission ? config.whenTrue : config.whenFalse;
}
