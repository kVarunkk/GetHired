"use client";

import React from "react";
import Link from "next/link"; // For internal links
import Brand from "../Brand";
import SocialsComponent from "../SocialsComponent";

const popularSearches = [
  {
    name: "Remote Jobs",
    href: "/jobs?location=Remote&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "Y Combinator Jobs",
    href: "/jobs?platform=ycombinator&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "Wellfound Jobs",
    href: "/jobs?platform=wellfound&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "RemoteOK Jobs",
    href: "/jobs?platform=remoteok&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "We Work Remotely Jobs",
    href: "/jobs?platform=weworkremotely&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "Uplers Jobs",
    href: "/jobs?platform=uplers&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "Greenhouse Jobs",
    href: "/jobs?platform=greenhouse&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "Glassdoor Jobs",
    href: "/jobs?platform=glassdoor&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "JobLeads Jobs",
    href: "/jobs?platform=jobleads&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "Working Nomads Jobs",
    href: "/jobs?platform=workingnomads&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "Jobs in San Francisco",
    href: "/jobs?location=San+Francisco&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "Jobs in New York",
    href: "/jobs?location=New+York&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "Tech Jobs in Bengaluru",
    href: "/jobs?jobTitleKeywords=developer%7Cengineer&location=Bangalore&sortBy=created_at&sortOrder=desc",
  },
  {
    name: "Senior Developer Roles",
    href: "/jobs?jobTitleKeywords=senior&sortBy=created_at&sortOrder=desc",
  },
];

const remoteJobs = [
  {
    name: "Remote Jobs in Bengaluru",
    href: "/remote-jobs/bangalore",
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

  // Array of popular location/type searches (Replace href with actual filtered routes)

  return (
    <footer className="px-4 py-20 lg:px-20 xl:px-40 2xl:px-80 mt-auto">
      <div className="container mx-auto max-w-6xl grid grid-cols-2 md:grid-cols-4 gap-8 text-center md:text-left">
        {/* ==================================== */}
        {/* 1. Brand / About (Col 1) */}
        {/* ==================================== */}
        <div className="flex flex-col items-center md:items-start gap-5 col-span-2 md:col-span-1">
          <Link href={"/"} className="w-fit">
            <Brand type="long" />
            {/* <span className="text-xl font-bold">GetHired</span>{" "} */}
            {/* Placeholder for Brand Component */}
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
          <h3 className="text-lg font-bold mb-3">Quick Links</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <Link
                href="/jobs"
                className="hover:underline hover:opacity-100 transition-opacity"
              >
                Jobs
              </Link>
            </li>
            <li>
              <Link
                href="/companies"
                className="hover:underline hover:opacity-100 transition-opacity"
              >
                Companies
              </Link>
            </li>
            <li>
              <Link
                href="/blog"
                className="hover:underline hover:opacity-100 transition-opacity"
              >
                Blog
              </Link>
            </li>
            <li>
              <Link
                href="/hire"
                className="hover:underline hover:opacity-100 transition-opacity"
              >
                For Companies
              </Link>
            </li>
            <li>
              <Link
                href="/privacy-policy"
                className="hover:underline hover:opacity-100 transition-opacity"
              >
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link
                href="/terms-of-service"
                className="hover:underline hover:opacity-100 transition-opacity"
              >
                Terms of Service
              </Link>
            </li>
          </ul>
        </div>

        {/* ==================================== */}
        {/* 3. Popular Searches (NEW Col 3) */}
        {/* ==================================== */}
        <div className="col-span-2 md:col-span-1">
          <h3 className="text-lg font-bold mb-3">Popular Searches</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {popularSearches.map((item) => (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className="hover:underline hover:opacity-100 transition-opacity"
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
          <h3 className="text-lg font-bold mb-3">Remote Jobs</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {remoteJobs.map((item) => (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className="hover:underline hover:opacity-100 transition-opacity"
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
