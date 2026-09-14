"use client";

import { useAuth } from "@/lib/auth-context";
import { activeNavItemId, canAccessModule, navItems } from "@/lib/workspace";
import StatCard from "./StatCard";
import { usePermissionToggleStat } from "@/hooks/usePermissionToggleStat";
import { overviewConfig, type OverviewStatData } from "@/config/direction-config";
import type { WorkspaceDirection } from "@/lib/workspace";

interface StatCardGridProps {
  direction: WorkspaceDirection;
  data: OverviewStatData;
}

/**
 * The Overview page's 4-card stat grid — one component for both
 * directions, entirely config-driven (see config/direction-config.tsx's
 * overviewConfig). Never branches on `direction` itself; it only reads
 * whichever config array that direction resolves to and calls the same
 * toggle hook 4 times, unconditionally, per slot — required by React's
 * hook-call-order rule (a variable-length .map() over slots calling a
 * hook inside would violate it the moment the two directions' slot
 * counts ever differed, which they don't today by design, but calling
 * each slot explicitly makes that a structural guarantee, not a
 * coincidence of both configs currently having 4 entries).
 */
export default function StatCardGrid({ direction, data }: StatCardGridProps) {
  const { user } = useAuth();
  const slots = overviewConfig[direction];
  const slot0 = usePermissionToggleStat(slots[0]);
  const slot1 = usePermissionToggleStat(slots[1]);
  const slot2 = usePermissionToggleStat(slots[2]);
  const slot3 = usePermissionToggleStat(slots[3]);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[slot0, slot1, slot2, slot3].map((slot, i) => (
        <StatCard
          key={i}
          label={slot.label}
          value={slot.getValue(data)}
          note={slot.note}
          notePill={slot.notePill}
          progress={slot.progress?.(data)}
          tone={slot.tone?.(data)}
          href={slot.href && navItems.some((item) => item.id === activeNavItemId(slot.href!) && canAccessModule(user, item, direction)) ? slot.href : undefined}
        />
      ))}
    </div>
  );
}
