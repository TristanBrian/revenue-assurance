"use client";

import { useParams } from "next/navigation";
import { heatmapConfig } from "@/config/direction-config";
import type { WorkspaceDirection } from "@/lib/workspace";
import Heatmap from "@/components/Heatmap";
import RequirePermission from "@/components/RequirePermission";

export default function LeakagePage() {
  const { direction } = useParams<{ direction: WorkspaceDirection }>();
  return (
    <RequirePermission code="view_heatmap">
      <div className="max-w-6xl mx-auto">
        <Heatmap direction={direction} config={heatmapConfig[direction]} />
      </div>
    </RequirePermission>
  );
}
