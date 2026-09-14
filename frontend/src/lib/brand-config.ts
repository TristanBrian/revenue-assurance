export interface LandingConfig {
  bgImage: string;
  cardBlur?: string;
}

export interface BrandConfig {
  companyName: string;
  systemName: string;
  shortName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  deepBlueColor: string;
  accentColor: string;
  highlightColor: string;
  bgColor: string;
  textColor: string;
  mutedSurface: string;
  mutedText: string;
  borderColor: string;
  landing: LandingConfig;
}

export const BRAND_CONFIG: BrandConfig = {
  companyName: "Kenya Pipeline Company",
  systemName: "Reconova Revenue Assurance",
  shortName: "Reconova",
  logoUrl: "/svg/kpc-logo-transparent.svg",
  primaryColor: "#047857",
  secondaryColor: "#0A192F",
  deepBlueColor: "#0A192F",
  accentColor: "#047857",
  highlightColor: "#047857",
  bgColor: "#F3F6FB",
  textColor: "#10233E",
  mutedSurface: "#E9EFF6",
  mutedText: "#51627A",
  borderColor: "#D8E2EE",
  landing: {
    bgImage: process.env.NEXT_PUBLIC_LANDING_BG_IMAGE || "/images/reconova-landing-hero.png",
    cardBlur: "backdrop-blur-lg",
  },
};
