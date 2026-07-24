"use client";

import Heatmap from "@/components/Heatmap";
import RequirePermission from "@/components/RequirePermission";

export default function HeatmapPage() {
  return (
    <RequirePermission code="view_heatmap">
      <Heatmap />
    </RequirePermission>
  );
}
