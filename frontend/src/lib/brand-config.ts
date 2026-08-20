export interface LandingConfig {
  bgImage: string;
  bgBlur: string;           // CSS blur value e.g. "blur(4px)"
  overlayOpacity: number;   // Opacity value e.g. 0.7
  overlayGradient: string;  // CSS overlay background gradient conforming to KPC colors
}

export interface BrandConfig {
  companyName: string;
  systemName: string;
  shortName: string;
  logoUrl: string | null;
  primaryColor: string;     // KPC Blue (#00529B)
  deepBlueColor: string;    // KPC Deep Blue (#003B6F)
  accentColor: string;      // KPC Orange (#F58220)
  highlightColor: string;   // Amber/Gold (#F59E0B)
  landing: LandingConfig;
}

export const BRAND_CONFIG: BrandConfig = {
  companyName: "Kenya Pipeline Company",
  systemName: "FlowGuard Revenue Assurance",
  shortName: "FlowGuard",
  logoUrl: "/kpc-logo.png",
  primaryColor: "#00529B",   // KPC Blue
  deepBlueColor: "#003B6F",  // KPC Deep Blue
  accentColor: "#F58220",    // KPC Safety Orange
  highlightColor: "#F59E0B",
  landing: {
    bgImage: process.env.NEXT_PUBLIC_LANDING_BG_IMAGE || "/images/flowguard-landing-hero.png",
    bgBlur: process.env.NEXT_PUBLIC_LANDING_BG_BLUR || "blur(4px)",
    overlayOpacity: Number(process.env.NEXT_PUBLIC_LANDING_OVERLAY_OPACITY) || 0.65,
    overlayGradient: "linear-gradient(135deg, rgba(7, 13, 25, 0.85) 0%, rgba(0, 59, 111, 0.75) 50%, rgba(7, 13, 25, 0.90) 100%)",
  },
};
