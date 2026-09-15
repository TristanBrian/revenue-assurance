"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ReviewQueueRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/inbound/review-queue");
  }, [router]);

  return (
    <div className="flex items-center justify-center p-16">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
    </div>
  );
}
