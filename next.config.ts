import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,
  images: {
    minimumCacheTTL: 60 * 60 * 24 * 7, // cache for 7 days
    remotePatterns: [
      {
        protocol: "https",
        hostname: "d1b7jdanqdrk6e.cloudfront.net",
        port: "",
        pathname: "/**",
      },
    ],
  },
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/**": ["./app/content/**/*"],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
