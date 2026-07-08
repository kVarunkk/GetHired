"use client";

import { LightningBoltIcon } from "@radix-ui/react-icons";
import { BentoCard, BentoGrid } from "@/components/magicui/bento-grid";
import { OrbitingCircles } from "../magicui/orbiting-circles";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn, getCloudfrontPath, platforms } from "@/utils/utils";

const cloudFrontUrl = getCloudfrontPath();

export function HowWeHelp({ jobCount }: { jobCount: number }) {
  const [isPaused, setIsPaused] = useState(false);
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
            : `Get access to a pool of over ${jobCount.toLocaleString()} quality listings from over 17 leading Job Boards.`,
          href: isHirePage ? "/company" : "/",
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
            <div className="relative flex flex-col items-center justify-center overflow-hidden h-[250px] lg:h-[350px] w-full opacity-80 scale-125">
              <OrbitingCircles paused={isPaused} iconSize={60} duration={25}>
                {platforms
                  .filter((platform, index) => index <= 5)
                  .map((each) => (
                    <Link
                      onMouseEnter={() => setIsPaused(true)}
                      onMouseLeave={() => setIsPaused(false)}
                      href={each.href}
                      key={each.id}
                      className="flex items-center justify-center p-3 rounded-full bg-white/10 dark:bg-gray-700/50 shadow-md backdrop-blur-sm transition-transform duration-300 ease-in-out
               hover:scale-150"
                    >
                      <Image
                        src={each.src}
                        className="object-contain max-w-full max-h-full drop-shadow-md "
                        alt={each.name || `Platform logo for ${each.id}`}
                        width={400}
                        height={400}
                        title={each.name}
                      />
                    </Link>
                  ))}
              </OrbitingCircles>

              <OrbitingCircles
                radius={100}
                reverse
                duration={15}
                iconSize={40}
                className="z-10"
                paused={isPaused}
              >
                {platforms
                  .filter((platform, index) => index > 5)
                  .map((each) => (
                    <Link
                      onMouseEnter={() => setIsPaused(true)}
                      onMouseLeave={() => setIsPaused(false)}
                      href={each.href}
                      key={each.id}
                      className="flex items-center justify-center p-2 rounded-full bg-white/10 dark:bg-gray-700/50 shadow-md backdrop-blur-sm transition-transform duration-300 ease-in-out
               hover:scale-150"
                    >
                      <Image
                        src={each.src}
                        className="object-contain max-w-full max-h-full drop-shadow-md "
                        alt={each.name || `Platform logo for ${each.id}`}
                        width={400}
                        height={400}
                        title={each.name}
                      />
                    </Link>
                  ))}
              </OrbitingCircles>

              <div className="absolute z-20  text-center">
                <LightningBoltIcon height={30} />
              </div>
            </div>
          ),
          className: "lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-3",
        },
        {
          name: isHirePage
            ? "Direct Talent Pipeline"
            : "Direct Connections & Opportunities",
          description: isHirePage
            ? "Manage all your active jobs and review pre-screened, engaged talent in a single, intuitive dashboard."
            : "Connect directly with companies. Discover exclusive job postings and get your profile seen by hiring managers who are actively looking for talent like yours, right here on our platform.",
          href: isHirePage ? "/company" : "/",
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
              )}
            />
          ),
          className: "lg:col-start-1 lg:col-end-3 lg:row-start-3 lg:row-end-4",
        },
      ];
    } else return [];
  }, [isPaused, setIsPaused, mounted, resolvedTheme, isHirePage]);
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
