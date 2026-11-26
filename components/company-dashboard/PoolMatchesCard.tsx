import { Upload, Users } from "lucide-react";
import DashboardSection from "@/components/dashboard/DashboardSection";
import { Button } from "@/components/ui/button";
import { candidateImportPath } from "@/helpers/candidates/paths";
import type { PoolSection } from "@/helpers/company-dashboard/load";
import { jobPoolMatchesPath } from "@/helpers/jobs/paths";
import TrackedLink from "./TrackedLink";

const SECTION = "pool_matches";

/**
 * CD-REQ-021/022: how many of the company's candidates match each new job
 * (counts only, never names or scores), or a way to bring them in.
 */
export default function PoolMatchesCard({ pool }: { pool: PoolSection }) {
  return (
    <DashboardSection title="From your candidates">
      {pool.type === "import" ? (
        <div className="flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Upload className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">Import candidates you already have</p>
              <p className="text-sm text-muted-foreground">We&apos;ll match them against your job posts.</p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <TrackedLink href={candidateImportPath()} track={{ section: SECTION, kind: "import", action: "import" }}>
              Import candidates
            </TrackedLink>
          </Button>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {pool.jobs.map((job) => (
            <li
              key={job.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="flex min-w-0 items-start gap-3">
                <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-medium tabular-nums">
                    {job.count}
                    {job.capped ? "+" : ""}
                  </span>
                  {` of your candidates ${job.count === 1 ? "matches" : "match"} `}
                  <span className="font-medium">{job.title}</span>
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <TrackedLink
                  href={jobPoolMatchesPath(job.id)}
                  track={{ section: SECTION, kind: "matches", action: "view" }}
                >
                  View
                </TrackedLink>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </DashboardSection>
  );
}
