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
  primaryColor: "#b3312c",
  secondaryColor: "#962723",
  deepBlueColor: "#171310",
  accentColor: "#b3312c",
  highlightColor: "#ec835a",
  bgColor: "#f7f6f4",
  textColor: "#26221f",
  mutedSurface: "#f1ede9",
  mutedText: "#736c67",
  borderColor: "#e8e3de",
  landing: {
    bgImage: process.env.NEXT_PUBLIC_LANDING_BG_IMAGE || "/images/reconova-landing-hero.png",
    cardBlur: "backdrop-blur-lg",
  },
};
