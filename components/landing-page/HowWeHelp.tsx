"use client";

import { BentoCard, BentoGrid } from "@/components/magicui/bento-grid";
import { PlatformGrid } from "./PlatformGrid";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cloudFrontUrl, cn, platforms } from "@/utils/utils";

export function HowWeHelp({ jobCount }: { jobCount: number }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const isHirePage = pathname.startsWith("/hire");

  useEffect(() => {
    setMounted(true);
  }, []);

  const memoizedFeatures = useMemo(() => {
    if (mounted) {
      return [
        {
          name: isHirePage
            ? "Personalized Candidate Discovery"
            : "Personalized Job Discovery",
          description: isHirePage
            ? "Stop wasting time on irrelevant job seeker profiles. Our advanced AI learns your preferences to bring you candidates you'll actually love"
            : "Stop wasting time on irrelevant jobs. Our advanced AI learns your preferences and skills to bring you opportunities you'll actually love",
          href: isHirePage ? "/company/profiles" : "/jobs",
          cta: `Find your Dream ${isHirePage ? "Candidate" : "Job"}`,
          background: (
            <Image
              alt="Feature"
              src={
                resolvedTheme === "dark"
                  ? isHirePage
                    ? `${cloudFrontUrl}/hire/company-howwehelp-dark-1.webp`
                    : `${cloudFrontUrl}/applicant/howwehelp-dark-1.webp`
                  : isHirePage
                    ? `${cloudFrontUrl}/hire/company-howwehelp-light-1.webp`
                    : `${cloudFrontUrl}/applicant/howwehelp-light-1.webp`
              }
              width={400}
              height={400}
              className="absolute -right-0 -top-0 opacity-30"
            />
          ),
          className: "lg:row-start-2 lg:row-end-3 lg:col-start-2 lg:col-end-3",
        },
        {
          name: isHirePage
            ? "Effortless Applicant Tracking"
            : "Effortless Application Management",
          description: isHirePage
            ? "Manage all your applications in one place"
            : "Manage all your applications in one place. Soon, you'll be able to auto-apply to multiple jobs with just a few clicks, saving you hours",
          href: isHirePage ? "/company" : "/jobs",
          cta: isHirePage ? "Learn more" : "Start Applying",
          background: (
            <Image
              alt="Feature"
              src={
                resolvedTheme === "dark"
                  ? isHirePage
                    ? `${cloudFrontUrl}/hire/company-howwehelp-dark-2.webp`
                    : `${cloudFrontUrl}/applicant/howwehelp-dark-2.webp`
                  : isHirePage
                    ? `${cloudFrontUrl}/hire/company-howwehelp-light-2.webp`
                    : `${cloudFrontUrl}/applicant/howwehelp-light-2.webp`
              }
              width={400}
              height={400}
              className="absolute -right-0 -top-0 opacity-30"
            />
          ),
          className: "lg:col-start-2 lg:col-end-3 lg:row-start-1 lg:row-end-2",
        },
        {
          name: isHirePage ? "AI Job Composer" : "Multiplatform Support",
          description: isHirePage
            ? "Create high-converting roles instantly. Our templates mandate key data to ensure clarity and attract only the most qualified, focused talent."
            : `Get access to a pool of over ${jobCount.toLocaleString()} quality listings from ${platforms.length} leading ATS platforms.`,
          href: isHirePage ? "/company" : "/jobs",
          cta: "Learn more",
          background: isHirePage ? (
            <div className="h-[150px] lg:h-[350px]">
              <Image
                alt="Feature"
                src={
                  resolvedTheme === "dark"
                    ? `${cloudFrontUrl}/hire/company-howwehelp-dark-4.webp`
                    : `${cloudFrontUrl}/hire/company-howwehelp-light-4.webp`
                }
                width={400}
                height={400}
                className="absolute -right-0 top-10 opacity-30 scale-150"
              />
            </div>
          ) : (
            <PlatformGrid />
          ),
          className: "lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-3",
        },
        {
          name: isHirePage
            ? "Direct Talent Pipeline"
            : "Direct Connections & Opportunities",
          description: isHirePage
            ? "Manage your open roles and review pre-screened talent in one dashboard."
            : "Apply to roles posted directly on GetHired and get seen by hiring managers who are actively hiring.",
          href: isHirePage ? "/company" : "/jobs",
          cta: "Learn more",
          background: (
            <Image
              alt="Feature"
              src={
                resolvedTheme === "dark"
                  ? isHirePage
                    ? `${cloudFrontUrl}/hire/company-howwehelp-dark-3.webp`
                    : `${cloudFrontUrl}/applicant/howwehelp-dark-3.webp`
                  : isHirePage
                    ? `${cloudFrontUrl}/hire/company-howwehelp-light-3.webp`
                    : `${cloudFrontUrl}/applicant/howwehelp-light-3.webp`
              }
              width={400}
              height={400}
              className={cn(
                "absolute -right-0 opacity-30  sm:h-auto sm:w-auto",
                !isHirePage && "-top-60 h-[450px] w-[400px]",
                isHirePage && "lg:top-0 lg:w-1/2",
              )}
            />
          ),
          className: "lg:col-start-1 lg:col-end-3 lg:row-start-3 lg:row-end-4",
        },
      ];
    } else return [];
  }, [mounted, resolvedTheme, isHirePage, jobCount]);
  return (
    <div
      id="howwehelp"
      className="flex flex-col  items-center px-4 py-3 lg:px-20 xl:px-40 2xl:px-80"
    >
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          {isHirePage
            ? "    How We Revolutionize Your Hiring"
            : "How We Help You Get Hired"}
        </h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          {isHirePage
            ? "Connecting you with exceptional, pre-qualified talent with speed and unmatched precision."
            : "Revolutionizing your job search with efficiency and precision."}
        </p>
      </div>
      <BentoGrid className="lg:grid-rows-3 lg:grid-cols-2">
        {memoizedFeatures.map((feature) => (
          <BentoCard key={feature.name} {...feature} />
        ))}
      </BentoGrid>
    </div>
  );
}
