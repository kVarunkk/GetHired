import type { NextConfig } from "next";

// Read at runtime by the PDF export (helpers/resume/render/pdf.tsx), so tracing can't see them:
// - the Noto Sans files, loaded by path;
// - pdfkit's standard fonts, required through its `#standard-fonts/*` subpath import,
//   which tracing doesn't follow. pdfkit loads Helvetica on every new document, even
//   when the page uses only registered fonts.
const RESUME_PDF_FILES = [
  "./node_modules/@fontsource/noto-sans/files/noto-sans-{latin,latin-ext,cyrillic,greek}-{400,700}-normal.woff",
  "./node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-{400,700}-normal.woff",
  "./node_modules/pdfkit/js/standard-fonts/**/*.cjs",
];

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
    // A spreadsheet import confirms up to 5,000 validated rows in one action
    // call (plan/bulk-import, BI-DEC-004); the default limit is 1 MB.
    serverActions: { bodySizeLimit: "8mb" },
  },
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "@react-pdf/renderer"],
  outputFileTracingIncludes: {
    "/**": ["./app/content/**/*"],
    "/api/resumes/[resume_id]/export": RESUME_PDF_FILES,
    "/api/company/applications/[id]/resume/export": RESUME_PDF_FILES,
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
      // API keys were replaced by OAuth sign-in to the MCP server.
      { source: "/dashboard/api-keys", destination: "/mcp", permanent: true },
      // Old emails link to these pages (RI-REQ-062).
      { source: "/resume-review", destination: "/resume", permanent: true },
      { source: "/resume-review/:path*", destination: "/resume", permanent: true },
    ];
  },
};

export default nextConfig;
