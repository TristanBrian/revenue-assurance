import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  compress: true,
  turbopack: {},
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.kpc.co.ke",
        port: "",
        pathname: "/**",
      },
      // Add any other hosts you might need
      // {
      //   protocol: "https",
      //   hostname: "**.kpc.co.ke",
      //   pathname: "/**",
      // },
    ],
  },
};

export default nextConfig;