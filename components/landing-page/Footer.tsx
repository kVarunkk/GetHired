"use client";

import React from "react";
import Link from "next/link";
import Brand from "../Brand";
import SocialsComponent from "../SocialsComponent";

const popularSearches = [
  {
    name: "Remote Jobs",
    href: "/jobs?location=Remote",
  },

  {
    name: "Workday Jobs",
    href: "/jobs?platform=workday",
  },
  {
    name: "BambooHR Jobs",
    href: "/jobs?platform=bamboohr",
  },
  {
    name: "Jobvite Jobs",
    href: "/jobs?platform=jobvite",
  },
  {
    name: "Greenhouse Jobs",
    href: "/jobs?platform=greenhouse",
  },
  {
    name: "Rippling Jobs",
    href: "/jobs?platform=rippling",
  },
  {
    name: "Workable Jobs",
    href: "/jobs?platform=workable",
  },
  {
    name: "Recruitee Jobs",
    href: "/jobs?platform=recruitee",
  },
  {
    name: "Personio Jobs",
    href: "/jobs?platform=personio",
  },
  {
    name: "JazzHR Jobs",
    href: "/jobs?platform=jazzhr",
  },
  {
    name: "Keka Jobs",
    href: "/jobs?platform=keka",
  },
  {
    name: "Jobs in India",
    href: "/jobs?location=India",
  },
  {
    name: "Jobs in San Francisco",
    href: "/jobs?location=San+Francisco",
  },
  {
    name: "Jobs in New York",
    href: "/jobs?location=New+York",
  },
  {
    name: "Tech Jobs in Bengaluru",
    href: "/jobs?jobTitleKeywords=developer%7Cengineer&location=Bengaluru",
  },
  {
    name: "Senior Developer Roles",
    href: "/jobs?jobTitleKeywords=senior",
  },
];

const remoteJobs = [
  {
    name: "Remote Jobs in Bengaluru",
    href: "/remote-jobs/Bengaluru",
  },
  {
    name: "Remote Jobs in Gurugram",
    href: "/remote-jobs/gurgaon",
  },
  {
    name: "Remote Jobs in Hyderabad",
    href: "/remote-jobs/hyderabad",
  },
  {
    name: "Remote Jobs in Pune",
    href: "/remote-jobs/pune",
  },
  {
    name: "Remote Jobs in Chennai",
    href: "/remote-jobs/chennai",
  },
  {
    name: "Remote Jobs in London",
    href: "/remote-jobs/london",
  },
  {
    name: "Remote Jobs in Canada",
    href: "/remote-jobs/canada",
  },
  {
    name: "Remote Jobs in Australia",
    href: "/remote-jobs/australia",
  },
  {
    name: "Remote Jobs in Germany",
    href: "/remote-jobs/germany",
  },
  {
    name: "Remote Jobs in Netherlands",
    href: "/remote-jobs/netherlands",
  },
  {
    name: "Remote Jobs in United Kingdom",
    href: "/remote-jobs/united%20kingdom",
  },
  {
    name: "Remote Jobs in United States",
    href: "/remote-jobs/united%20states",
  },
];

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="m-0 mt-auto w-full overflow-hidden pt-20 pb-0">
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
        <div className="container mx-auto max-w-6xl grid grid-cols-2 md:grid-cols-4 gap-8 text-center md:text-left">
          {/* ==================================== */}
          {/* 1. Brand / About (Col 1) */}
          {/* ==================================== */}
          <div className="flex flex-col items-center md:items-start gap-5 col-span-2 md:col-span-1">
            <Link href={"/"} className="w-fit">
              <Brand type="long" />
            </Link>
            <p className="text-sm text-muted-foreground">
              Your smartest path to the perfect job.
            </p>

            <div className="flex flex-col mt-16">
              <SocialsComponent isFooter={true} />
              <p className="text-sm text-muted-foreground">
                &copy; {currentYear} GetHired. All rights reserved.
              </p>
            </div>
          </div>

          {/* ==================================== */}
          {/* 2. Quick Links (Col 2) */}
          {/* ==================================== */}
          <div className="col-span-2 md:col-span-1">
            <h3 className="text-sm font-semibold mb-3">Quick Links</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link
                  href="/ai-interview"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  AI Interview
                </Link>
              </li>
              <li>
                <Link
                  href="/ai-resume-checker"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  AI Resume Checker
                </Link>
              </li>
              <li>
                <Link
                  href="/jobs"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  Jobs
                </Link>
              </li>
              <li>
                <Link
                  href="/companies"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  Companies
                </Link>
              </li>
              <li>
                <Link
                  href="/blog"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  Blog
                </Link>
              </li>
              <li>
                <Link
                  href="/hire"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  For Companies
                </Link>
              </li>
              <li>
                <Link
                  href="/mcp-server"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  MCP Server
                </Link>
              </li>
              <li>
                <Link
                  href="/mcp-server/companies"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  MCP for Hiring Teams
                </Link>
              </li>
              <li>
                <Link
                  href="/extension"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  Chrome Extension
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy-policy"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms-of-service"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  href="/about"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  About Us
                </Link>
              </li>
              <li>
                <Link
                  href="/contact"
                  className="transition-colors hover:text-foreground hover:underline"
                >
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          {/* ==================================== */}
          {/* 3. Popular Searches (NEW Col 3) */}
          {/* ==================================== */}
          <div className="col-span-2 md:col-span-1">
            <h3 className="text-sm font-semibold mb-3">Popular Searches</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {popularSearches.map((item) => (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    className="transition-colors hover:text-foreground hover:underline"
                    prefetch={false}
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* ==================================== */}
          {/* 4. Remote Jobs */}
          {/* ==================================== */}
          <div className="col-span-2 md:col-span-1">
            <h3 className="text-sm font-semibold mb-3">Remote Jobs</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {remoteJobs.map((item) => (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    className="transition-colors hover:text-foreground hover:underline"
                    prefetch={false}
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      {/* The wordmark spans the full viewport width and sits flush on the
          bottom edge: an SVG stretched to its box with the baseline on the
          bottom line ("GetHired" has no descenders). */}
      <svg
        className="mt-16 block h-auto w-full md:mt-24 [mask-image:linear-gradient(to_bottom,#000_25%,rgba(0,0,0,0.15)_100%)]"
        viewBox="0 0 1000 184"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <text
          x="0"
          y="184"
          textLength="1000"
          lengthAdjust="spacingAndGlyphs"
          fontSize="244"
          fontWeight="600"
          letterSpacing="-14"
          className="fill-foreground"
        >
          GetHired
        </text>
      </svg>
    </footer>
  );
}
