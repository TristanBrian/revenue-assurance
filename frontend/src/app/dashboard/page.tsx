"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getDefaultDirection } from "@/lib/workspace";

/** Superseded by /dashboard/[direction]/overview — see the workspace
 * refactor spec. Redirects to the current user's default workspace
 * (inbound for most roles, outbound for inuka_manager). */
export default function DashboardRootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(`/dashboard/${getDefaultDirection(user)}/overview`);
  }, [loading, user, router]);

  return (
    <div className="flex items-center justify-center p-12">
      <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );
}
