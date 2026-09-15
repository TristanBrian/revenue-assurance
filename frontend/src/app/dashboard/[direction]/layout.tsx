"use client";

import { useEffect } from "react";
import { useParams, useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getDefaultDirection, isDirectionAllowed, activeNavItemId, navItems, canAccessModule, REVIEW_QUEUE_ITEM } from "@/lib/workspace";

/**
 * Route guard for the whole /dashboard/[direction]/* segment — the route-
 * based replacement for the old client-state DirectionContext's locking
 * (Depot Supervisor -> inbound only, inuka_manager -> outbound only; see
 * lib/workspace.ts's own docstring). A locked role hitting the other
 * segment (by URL, a stale bookmark, or a workspace switcher bug) gets
 * redirected to the one they're actually allowed to see, rather than
 * rendering data their role isn't supposed to reach — the same boundary
 * the old context enforced, just expressed at the route level now.
 *
 * Also rejects a `direction` value that isn't "inbound"/"outbound" at all
 * (a typo'd or hand-edited URL) the same way, rather than letting an
 * invalid direction string reach every page/API call underneath.
 */
export default function DirectionLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const params = useParams<{ direction: string }>();
  const router = useRouter();
  const direction = params.direction;
  const pathname = usePathname();
  const routeItems = [...navItems, REVIEW_QUEUE_ITEM];
  const item = routeItems.find((module) => module.id === activeNavItemId(pathname));
  const moduleAllowed = !!item && isDirectionAllowed(user, direction) && canAccessModule(user, item, direction);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    if (user?.roles.includes("system_admin")) {
      router.replace("/dashboard/admin");
      return;
    }
    if (!isDirectionAllowed(user, direction)) {
      router.replace(`/dashboard/${getDefaultDirection(user)}/overview`);
    }
  }, [loading, user, direction, router]);

  if (loading || user?.roles.includes("system_admin") || !isDirectionAllowed(user, direction)) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!moduleAllowed) return <section className="rounded-xl border border-border bg-card p-8" role="alert"><h1 className="text-xl font-bold">Module unavailable</h1><p className="mt-2 text-sm text-muted-foreground">This module is outside your workspace or role permissions. Choose an available module from the navigation.</p></section>;
  return <>{children}</>;
}
