"use client";

import { Button } from "../ui/button";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn, HeroMaskStyle } from "@/utils/utils";

const JOB_SEEKER_DARK = "/hero/job-seeker-hero-dark.png";
const JOB_SEEKER_LIGHT = "/hero/job-seeker-hero-light.png";
const HIRE_PAGE_DARK = "/hero/company-hero-dark.png";
const HIRE_PAGE_LIGHT = "/hero/company-hero-light.png";

export default function Hero() {
  const pathname = usePathname();
  const isHirePage = pathname.startsWith("/hire");

  return (
    <div className="flex flex-col gap-5 w-full items-center text-center px-4 py-3 lg:px-20 xl:px-40 2xl:px-80">
      <h1 className="text-5xl sm:text-7xl font-black tracking-tight leading-[1.1]">
        Smartest Path to the Perfect {isHirePage ? "Candidate" : "Job"}
      </h1>
      {isHirePage ? (
        <p className="text-muted-foreground text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed">
          Find <strong>Exceptional</strong> candidates,{" "}
          <strong>Streamline</strong> your screening, and connect{" "}
          <strong>Directly</strong> with motivated talent
        </p>
      ) : (
        <p className="text-muted-foreground text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed">
          Find your next job from over 2500 quailty listings with the power of
          AI
        </p>
      )}
      <div className="flex items-center gap-5">
        {!isHirePage && (
          <Link href={"/jobs"}>
            <Button>Get Hired!</Button>
          </Link>
        )}
        <Link href={isHirePage ? "/company" : "/hire"}>
          <Button
            variant={isHirePage ? "default" : "outline"}
            className={cn(
              !isHirePage &&
                "transition-colors duration-200 hover:bg-primary hover:text-primary-foreground border-primary text-primary",
            )}
          >
            Hire Talent
          </Button>
        </Link>
      </div>

      <div>
        <Image
          className="rounded-xl border border-border drop-shadow-xl mt-8 dark:hidden"
          src={isHirePage ? HIRE_PAGE_LIGHT : JOB_SEEKER_LIGHT}
          style={HeroMaskStyle}
          height={1200}
          width={1200}
          alt="Snapshot of the GetHired Job Board"
          priority
        />
        <Image
          className="rounded-xl border border-border drop-shadow-xl mt-8 hidden dark:block"
          src={isHirePage ? HIRE_PAGE_DARK : JOB_SEEKER_DARK}
          style={HeroMaskStyle}
          height={1200}
          width={1200}
          alt="Snapshot of the GetHired Job Board"
          priority
        />
      </div>
    </div>
  );
}
