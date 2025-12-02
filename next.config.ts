// next.config.js
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,
  images: {
    remotePatterns: [
      {
        protocol: "https", // Specify the protocol
        hostname: "vehnycoyrmqdfywybboc.supabase.co", // The exact hostname
        port: "", // Leave empty if no specific port is used (which is typical for HTTPS)
        pathname: "/storage/v1/object/public/images/landing_page/**", // Optional: restrict to a specific path if desired
      },
      {
        protocol: "https", // Specify the protocol
        hostname: "vehnycoyrmqdfywybboc.supabase.co", // The exact hostname
        port: "", // Leave empty if no specific port is used (which is typical for HTTPS)
        pathname: "/storage/v1/object/public/images/company_logos/**", // Optional: restrict to a specific path if desired
      },
    ],
  },
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
