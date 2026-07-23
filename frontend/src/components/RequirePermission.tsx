"use client";

import { useAuth } from "@/lib/auth-context";

export default function RequirePermission({
  code,
  children,
}: {
  code: string;
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }

  if (!user?.permissions.includes(code)) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        <p className="font-medium">Not authorized</p>
        <p className="mt-1">
          Your role doesn&apos;t have access to this section.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
