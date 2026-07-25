import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  compress: true,
  turbopack: {},
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;