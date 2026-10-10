import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  images: {
    unoptimized: true,
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
  // Cloud Run's filesystem is in-memory, so ISR/fetch cache files written to
  // .next would grow RAM without bound. Keep the cache in a capped LRU only.
  cacheMaxMemorySize: 32 * 1024 * 1024,
  experimental: {
    isrFlushToDisk: false,
  },
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/**": ["./app/content/**/*"],
  },
};

export default nextConfig;
