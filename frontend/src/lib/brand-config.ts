export interface LandingConfig {
  bgImage: string;
  cardBlur?: string;
}

export interface BrandConfig {
  companyName: string;
  systemName: string;
  shortName: string;
  logoUrl: string | null;
  primaryColor: string;       // Red Accent (#B3312C)
  secondaryColor: string;     // Warm Near-Black (#1F1B19)
  deepBlueColor: string;      // Brand Dark Surface (#1F1B19)
  accentColor: string;        // Red Accent (#B3312C)
  highlightColor: string;     // Red Accent (#B3312C)
  bgColor: string;            // Off-White (#F7F6F4)
  textColor: string;          // Near-Black (#26221F)
  mutedSurface: string;       // (#F1EDE9)
  mutedText: string;          // (#736C67)
  borderColor: string;        // (#E8E3DE)
  landing: LandingConfig;
}

export const BRAND_CONFIG: BrandConfig = {
  companyName: "Kenya Pipeline Company",
  systemName: "FlowGuard Revenue Assurance",
  shortName: "FlowGuard",
  logoUrl: "/svg/kpc-logo-transparent.svg",
  primaryColor: "#B3312C",     // Red primary accent
  secondaryColor: "#1F1B19",   // Warm near-black surface
  deepBlueColor: "#1F1B19",    // Warm near-black surface
  accentColor: "#B3312C",      // Red accent
  highlightColor: "#B3312C",
  bgColor: "#F7F6F4",
  textColor: "#26221F",
  mutedSurface: "#F1EDE9",
  mutedText: "#736C67",
  borderColor: "#E8E3DE",
  landing: {
    bgImage: process.env.NEXT_PUBLIC_LANDING_BG_IMAGE || "/images/flowguard-landing-hero.png",
    cardBlur: "backdrop-blur-lg",
  },
};
