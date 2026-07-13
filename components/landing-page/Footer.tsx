"use client";

import React from "react";
import Link from "next/link";
import Brand from "../Brand";
import SocialsComponent from "../SocialsComponent";
import { Button } from "../ui/button";

const popularSearches = [
  {
    name: "Remote Jobs",
    href: "/jobs?location=Remote",
  },
  {
    name: "Indeed Jobs",
    href: "/jobs?platform=indeed",
  },
  {
    name: "Naukri Jobs",
    href: "/jobs?platform=naukri",
  },
  {
    name: "Y Combinator Jobs",
    href: "/jobs?platform=ycombinator",
  },
  {
    name: "Wellfound Jobs",
    href: "/jobs?platform=wellfound",
  },
  {
    name: "RemoteOK Jobs",
    href: "/jobs?platform=remoteok",
  },
  {
    name: "We Work Remotely Jobs",
    href: "/jobs?platform=weworkremotely",
  },
  {
    name: "Uplers Jobs",
    href: "/jobs?platform=uplers",
  },
  {
    name: "Greenhouse Jobs",
    href: "/jobs?platform=greenhouse",
  },
  {
    name: "a16z Jobs",
    href: "/jobs?platform=a16z",
  },
  {
    name: "Lightspeed Jobs",
    href: "/jobs?platform=lightspeed",
  },
  {
    name: "Glassdoor Jobs",
    href: "/jobs?platform=glassdoor",
  },
  {
    name: "JobLeads Jobs",
    href: "/jobs?platform=jobleads",
  },
  {
    name: "Working Nomads Jobs",
    href: "/jobs?platform=workingnomads",
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
    <footer className="px-4 py-20 lg:px-20 xl:px-40 2xl:px-80 mt-auto">
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
          <h3 className="text-lg font-bold mb-3">Quick Links</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <Link
                href="/ai-resume-checker"
                className="hover:underline hover:opacity-100 transition-opacity"
              >
                AI Resume Checker
              </Link>
            </li>
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
                href="/mcp-server"
                className="hover:underline hover:opacity-100 transition-opacity"
              >
                MCP Server
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
          <h3 className="text-lg font-bold mb-3">Remote Jobs</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {remoteJobs.map((item) => (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className="hover:underline hover:opacity-100 transition-opacity"
                  prefetch={false}
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="col-span-2 ">
          <h3 className="text-lg font-bold mb-3 ">AI Resume Checker</h3>
          <Link href={"/resume-review"}>
            <Button className="w-full sm:w-auto bg-brand hover:bg-brand/70 text-brand-foreground font-bold h-11 px-8 rounded-xl shadow-lg shadow-brand/20 transition-all active:scale-95 disabled:opacity-70">
              Review My Resume
            </Button>
          </Link>{" "}
        </div>
      </div>
    </footer>
  );
}
