import type { NextConfig } from "next";

const isRenderProduction = true;
// process.env.RENDER === "true"
const nextConfig: NextConfig = {
  output: "standalone",
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
    ignoreBuildErrors: isRenderProduction,
  },
  eslint: {
    ignoreDuringBuilds: isRenderProduction,
  },
};

export default nextConfig;
