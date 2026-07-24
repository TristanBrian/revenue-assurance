export interface BrandConfig {
  companyName: string;
  systemName: string;
  shortName: string;
  logoUrl: string | null;
  primaryColor: string;     // Navy Blue (#0A2E5C)
  secondaryColor: string;   // Red (#C8102E)
  accentColor: string;      // Cyan (#00B8D9)
  highlightColor: string;   // Gold (#FFC857)
}

export const BRAND_CONFIG: BrandConfig = {
  companyName: "FlowGuard",
  systemName: "Revenue Assurance",
  shortName: "FlowGuard",
  logoUrl: "https://www.kpc.co.ke/wp-content/uploads/2020/12/kpc-logo.png",
  primaryColor: "#0A2E5C",   // Navy Blue
  secondaryColor: "#C8102E", // Red (FlowGuard Revenue Assurance)
  accentColor: "#00B8D9",    // Cyan
  highlightColor: "#FFC857", // Gold
};
