import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { ClipboardCheck, ExternalLink, FileText, FileUser, ListChecks } from "lucide-react";
import EntityLayout from "@/components/EntityLayout";
import type { EntityNavItem } from "@/components/EntityNav";
import Error from "@/components/Error";
import InterviewTime from "@/components/interviews/InterviewTime";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { loadKitFrame } from "@/helpers/interviews/kit-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ interview_id: string }>;
}): Promise<Metadata> {
  const { interview_id } = await params;
  const frame = await loadKitFrame(interview_id).catch(() => null);
  const name = frame?.result.ok ? frame.result.kit.interview.name : null;
  if (!name) return { title: "Interview kit" };
  return { title: { default: name, template: `%s · ${name} | GetHired` } };
}

/**
 * The interview kit's frame (IVT-019, IV-REQ-034): the sections sidebar
 * (guide, application, resume, scorecard) and the header with the meeting
 * link. Any company member on the panel can open it, with or without
 * `applicants.view`, while the interview is upcoming and for 7 days after it
 * ends; after that only their scorecard. `get_interview_kit` does the checks.
 */
export default async function InterviewKitLayout({
  params,
  children,
}: {
  params: Promise<{ interview_id: string }>;
  children: ReactNode;
}) {
  try {
    const { interview_id } = await params;
    const frame = await loadKitFrame(interview_id);
    if (!frame) notFound();
    const { result, base } = frame;

    if (!result.ok) {
      return (
        <div className="flex flex-col gap-6 p-4">
          <PageHeader title="Interview kit" backHref="/company/my-interviews" backLabel="My interviews" />
          <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
            This interview kit has closed. Kits stay open for 7 days after the interview.
          </p>
        </div>
      );
    }

    const { kit } = result;
    // A closed kit keeps only the member's scorecard, on the index page.
    const items: EntityNavItem[] =
      kit.access === "kit"
        ? [
            { href: base, label: "Guide", icon: <ListChecks />, exact: true },
            { href: `${base}/application`, label: "Application", icon: <FileText /> },
            { href: `${base}/resume`, label: "Resume", icon: <FileUser /> },
            { href: `${base}/scorecard`, label: "Scorecard", icon: <ClipboardCheck /> },
          ]
        : [{ href: base, label: "Scorecard", icon: <ClipboardCheck />, exact: true }];

    const time = <InterviewTime startsAt={kit.interview.startsAt} endsAt={kit.interview.endsAt} />;

    return (
      <EntityLayout
        nav={{
          label: "Interview kit sections",
          title: kit.access === "kit" ? kit.candidate.name : kit.interview.name,
          backHref: "/company/my-interviews",
          backLabel: "My interviews",
          items,
        }}
        header={
          kit.access === "kit" ? (
            <PageHeader
              eyebrow="Interview kit"
              title={
                <span className="[overflow-wrap:anywhere]">
                  {kit.interview.name} · {kit.candidate.name}
                </span>
              }
              description={
                <span className="[overflow-wrap:anywhere]">
                  {kit.job.title} · {time} · {kit.interview.panel.map((p) => p.name).join(", ")}
                </span>
              }
              actions={
                kit.interview.meetingUrl ? (
                  <Button asChild variant="outline">
                    <a href={kit.interview.meetingUrl} target="_blank" rel="noopener noreferrer">
                      Join meeting <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <PageHeader eyebrow="Interview kit" title={kit.interview.name} description={time} />
          )
        }
      >
        <div className="mb-20 flex flex-col gap-6">{children}</div>
      </EntityLayout>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
