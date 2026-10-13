import Link from "next/link";
import { Button } from "./ui/button";
import AgentHeroDemo from "./landing-page/AgentHeroDemo";

export default function HeroRemotePage({
  location,
  jobCount,
}: {
  location: string;
  jobCount: number;
}) {
  const decodedLocation = decodeURIComponent(location);

  return (
    <div className="flex flex-col gap-5 w-full items-center text-center px-4 py-3 lg:px-20 xl:px-40 2xl:px-80">
      <h1 className="text-5xl sm:text-7xl font-semibold tracking-tight leading-[1.1]">
        Top Remote Jobs in {decodedLocation}
      </h1>

      <p className="text-muted-foreground text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed">
        Find your next remote job from over {jobCount.toLocaleString()} quality
        listings with the power of AI
      </p>

      <div className="flex items-center gap-5">
        <Link
          href={`/jobs?location=${location.toLowerCase()}|remote&sortBy=created_at&sortOrder=desc`}
        >
          <Button variant="brand">Find Remote Jobs</Button>
        </Link>
      </div>

      <div className="mt-8 w-full max-w-5xl">
        <AgentHeroDemo />
      </div>
    </div>
  );
}
