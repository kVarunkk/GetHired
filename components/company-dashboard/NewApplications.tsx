import DashboardSection from "@/components/dashboard/DashboardSection";
import { Badge } from "@/components/ui/badge";
import { agoText } from "@/helpers/company-dashboard/summary";
import type { NewApplication } from "@/helpers/company-dashboard/load";
import TrackedLink from "./TrackedLink";

const BOARD_NAMES: Record<string, string> = {
  google: "Google",
  bing: "Bing",
  jooble: "Jooble",
  adzuna: "Adzuna",
  talent: "Talent.com",
  ziprecruiter: "ZipRecruiter",
  indeed: "Indeed",
  naukri: "Naukri",
};

/** Where an application came from, in words. */
export function applicationSourceLabel(source: string, detail: string | null): string {
  switch (source) {
    case "careers_page":
      return "Careers page";
    case "job_board":
      return (detail && BOARD_NAMES[detail]) || "Job board";
    case "imported":
      return "Imported";
    case "outreach":
      return "Outreach";
    default:
      return "GetHired";
  }
}

/** CD-REQ-023: the newest applications nobody has moved out of Applied. */
export default function NewApplications({ applications, now }: { applications: NewApplication[]; now: Date }) {
  if (applications.length === 0) return null;
  return (
    <DashboardSection
      title="New applications"
      action={{ label: "View all", href: "/company/applications?status=submitted" }}
    >
      <ul className="divide-y rounded-xl border">
        {applications.map((application) => (
          <li key={application.id}>
            <TrackedLink
              href={`/company/applications/${application.id}`}
              track={{ section: "new_applications", kind: "application", action: "open" }}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">{application.name}</span>
                <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {`${application.jobTitle} · ${applicationSourceLabel(application.source, application.sourceDetail)} · ${agoText(application.createdAt, now)}`}
                </span>
              </span>
              {application.fitScore !== null && (
                <Badge variant="outline" className="shrink-0 tabular-nums">
                  Fit {application.fitScore}
                </Badge>
              )}
            </TrackedLink>
          </li>
        ))}
      </ul>
    </DashboardSection>
  );
}
