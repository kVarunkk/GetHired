"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "./ui/button";

const maskStyle = {
  maskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
  WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
};

const JOB_SEEKER_DARK = "/hero/job-seeker-hero-dark.png";
const JOB_SEEKER_LIGHT = "/hero/job-seeker-hero-light.png";

export default function HeroRemotePage({ location }: { location: string }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const decodedLocation = decodeURIComponent(location);

  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    setMounted(true);
  }, []);

  const getImagePath = () => {
    return isDark ? JOB_SEEKER_DARK : JOB_SEEKER_LIGHT;
  };

  return (
    <div className="flex flex-col gap-5 w-full items-center text-center px-4 py-3 lg:px-20 xl:px-40 2xl:px-80">
      <h1 className="text-5xl sm:text-6xl font-extrabold">
        Top Remote Jobs in {decodedLocation}
      </h1>

      <p>
        Find your next remote job from over 1500 quailty listings with the power
        of AI
      </p>

      <div className="flex items-center gap-5">
        <Link
          href={`/jobs?location=${location.toLowerCase()}|remote&sortBy=created_at&sortOrder=desc`}
        >
          <Button>Find Remote Jobs</Button>
        </Link>
      </div>

      {mounted && (
        <Image
          className="rounded-xl border border-border drop-shadow-xl mt-8"
          src={getImagePath()}
          style={maskStyle}
          height={2000}
          width={2000}
          alt="Snapshot of the GetHired Job Board"
          priority
        />
      )}
    </div>
  );
}
