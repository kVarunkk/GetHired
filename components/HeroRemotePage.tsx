import Link from "next/link";
import Image from "next/image";
import { Button } from "./ui/button";
import { HeroMaskStyle } from "@/utils/utils";

const JOB_SEEKER_DARK = "/hero/job-seeker-hero-dark.png";
const JOB_SEEKER_LIGHT = "/hero/job-seeker-hero-light.png";

export default function HeroRemotePage({ location }: { location: string }) {
  const decodedLocation = decodeURIComponent(location);

  return (
    <div className="flex flex-col gap-5 w-full items-center text-center px-4 py-3 lg:px-20 xl:px-40 2xl:px-80">
      <h1 className="text-5xl sm:text-7xl font-black tracking-tight leading-[1.1]">
        Top Remote Jobs in {decodedLocation}
      </h1>

      <p className="text-muted-foreground text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed">
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

      <div>
        <Image
          className="rounded-xl border border-border drop-shadow-xl mt-8 dark:hidden"
          src={JOB_SEEKER_LIGHT}
          style={HeroMaskStyle}
          height={1200}
          width={1200}
          alt="Snapshot of the GetHired Job Board"
          priority
        />
        <Image
          className="rounded-xl border border-border drop-shadow-xl mt-8 hidden dark:block"
          src={JOB_SEEKER_DARK}
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
