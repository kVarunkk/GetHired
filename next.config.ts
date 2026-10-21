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
    // Inline the (small) Tailwind CSS into the HTML, so first paint doesn't
    // wait on separate render-blocking stylesheet requests.
    inlineCss: true,
  },
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/**": ["./app/content/**/*"],
  },
  // The company "Applicants" pages became "Applications". Old links (in sent
  // emails, bookmarks and agent chats) keep working.
  async redirects() {
    return [
      { source: "/company/applicants", destination: "/company/applications", permanent: true },
      { source: "/company/applicants/:id", destination: "/company/applications/:id", permanent: true },
      {
        source: "/company/job-posts/:id/applicants",
        destination: "/company/job-posts/:id/applications",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
