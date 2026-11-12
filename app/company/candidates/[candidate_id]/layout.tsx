import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { Briefcase, FileText, User } from "lucide-react";
import Error from "@/components/Error";
import CandidateActions from "@/components/candidates/CandidateActions";
import EntityLayout from "@/components/EntityLayout";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { CANDIDATES_LIST_PATH, candidatePath, loadCandidateFrame } from "@/helpers/candidates/candidate-page";

/** The candidate's name titles the overview, and the sections get it as a suffix. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ candidate_id: string }>;
}): Promise<Metadata> {
  const { candidate_id } = await params;
  const frame = await loadCandidateFrame(candidate_id).catch(() => null);
  if (!frame) return { title: "Candidate" };
  const name = frame.candidate.full_name;
  return { title: { default: name, template: `%s · ${name} | GetHired` } };
}

/**
 * A company candidate's frame (BI-REQ-004): the sections sidebar (overview,
 * applications, resume) and the header with add-to-job and delete. 404 for
 * a candidate the viewer can't read (BI-PERM-002).
 */
export default async function CandidateLayout({
  params,
  children,
}: {
  params: Promise<{ candidate_id: string }>;
  children: ReactNode;
}) {
  try {
    const { candidate_id } = await params;
    const frame = await loadCandidateFrame(candidate_id);
    if (!frame) notFound();
    const { candidate, applications, jobs, canAddToJob, importJobCount, canDelete } = frame;

    const base = candidatePath(candidate.id);
    return (
      <EntityLayout
        nav={{
          label: "Candidate sections",
          title: candidate.full_name,
          backHref: CANDIDATES_LIST_PATH,
          backLabel: "Candidates",
          items: [
            { href: base, label: "Overview", icon: <User />, exact: true },
            { href: `${base}/applications`, label: `Applications (${applications.length})`, icon: <Briefcase /> },
            { href: `${base}/resume`, label: "Resume", icon: <FileText /> },
          ],
        }}
        header={
          <PageHeader
            eyebrow="Candidate"
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span className="[overflow-wrap:anywhere]">{candidate.full_name}</span>
                {candidate.claimed_user_id && <Badge variant="secondary">Joined GetHired</Badge>}
                {candidate.email_opted_out_at && <Badge variant="outline">Unsubscribed</Badge>}
              </span>
            }
            description={
              [candidate.current_title, candidate.current_company].filter(Boolean).join(" at ") || undefined
            }
            actions={
              <CandidateActions
                candidate={{ id: candidate.id, name: candidate.full_name, email: candidate.email }}
                jobs={jobs}
                canAddToJob={canAddToJob}
                importJobCount={importJobCount}
                canDelete={canDelete}
                listHref={CANDIDATES_LIST_PATH}
              />
            }
          />
        }
      >
        {children}
      </EntityLayout>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
