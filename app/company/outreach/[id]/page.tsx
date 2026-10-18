import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { Briefcase, User } from "lucide-react";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import AskAgentAboutOutreach from "@/components/agent/recruiter/AskAgentAboutOutreach";
import OutreachStatusBadge from "@/components/outreach/OutreachStatusBadge";
import PlainMessage from "@/components/outreach/PlainMessage";
import WithdrawOutreachButton from "@/components/outreach/WithdrawOutreachButton";
import MemberAvatar from "@/components/team/MemberAvatar";
import { Button } from "@/components/ui/button";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { DECLINE_REASON_OPTIONS } from "@/helpers/outreach/config";
import { getCompanyOutreach, type CompanyOutreachDetail } from "@/helpers/outreach/detail";
import { isOpen } from "@/helpers/outreach/list";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const declineLabel = (reason: CompanyOutreachDetail["declineReason"]) =>
  DECLINE_REASON_OPTIONS.find((o) => o.value === reason)?.label ?? null;

/** The candidate's side of the outreach: waiting, their answer, or why it closed. */
function Answer({ outreach }: { outreach: CompanyOutreachDetail }) {
  const name = outreach.candidateName ?? "The candidate";
  const answeredOn = outreach.respondedAt ? ` on ${formatDate(outreach.respondedAt)}` : "";

  switch (outreach.status) {
    case "sent":
      return isOpen(outreach) ? (
        <p className="text-sm text-muted-foreground">
          No answer yet. {name} can answer until {formatDate(outreach.expiresAt)}.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">No answer. It closes shortly.</p>
      );
    case "interested":
      return (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            {name} is interested{answeredOn}.
          </p>
          {outreach.candidateNote && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">Their note</p>
              <p className="whitespace-pre-wrap break-words">{outreach.candidateNote}</p>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">How to reach them</p>
            <p className="break-words" data-testid="candidate-contact">
              {outreach.candidateContact ?? "Their contact details are on their profile."}
            </p>
          </div>
        </div>
      );
    case "not_interested": {
      const reason = declineLabel(outreach.declineReason);
      return (
        <p className="text-sm">
          {name} isn&apos;t interested{answeredOn}.{reason ? ` Reason: ${reason}.` : ""}
        </p>
      );
    }
    case "expired":
      return <p className="text-sm text-muted-foreground">No reply before {formatDate(outreach.expiresAt)}.</p>;
    case "withdrawn":
      return <p className="text-sm text-muted-foreground">You withdrew this message.</p>;
    case "reported":
      return (
        <p className="text-sm text-muted-foreground">
          {name} reported this message{answeredOn}. GetHired reviews reports.
        </p>
      );
  }
}

/**
 * One of the company's outreach messages: the message as sent, who sent it,
 * the candidate's answer (with their contact on Interested) and, under the
 * actions, a way to ask the agent about it.
 */
export default async function CompanyOutreachDetailPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) notFound();
    const user = await getUserFromRequest();
    if (!user) notFound();
    const supabase = await createClient();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();

    const outreach = await getCompanyOutreach({ supabase, company }, id);
    if (!outreach) notFound();

    const candidate = outreach.candidateName ?? "Candidate";

    return (
      <div className="flex w-full max-w-3xl flex-col gap-6 p-4 mb-20">
        <PageHeader
          backHref="/company/outreach"
          backLabel="Back to outreach"
          eyebrow={
            <>
              To {candidate}
              {outreach.jobTitle ? ` · ${outreach.jobTitle}` : ""}
            </>
          }
          title={outreach.subject}
          description={
            <div className="flex flex-wrap items-center gap-2">
              {outreach.senderName && <MemberAvatar name={outreach.senderName} className="h-6 w-6" />}
              <span>
                Sent {formatDate(outreach.sentAt)}
                {outreach.senderName ? ` by ${outreach.senderName}` : ""}
                {outreach.source === "agent" ? " with the agent" : ""}
              </span>
            </div>
          }
          actions={<OutreachStatusBadge status={outreach.status} className="shrink-0" />}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/company/profiles/${outreach.candidateUserId}`}>
              <User className="h-4 w-4" />
              View profile
            </Link>
          </Button>
          {outreach.jobPostId && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/company/job-posts/${outreach.jobPostId}`}>
                <Briefcase className="h-4 w-4" />
                View job post
              </Link>
            </Button>
          )}
          {outreach.status === "sent" && <WithdrawOutreachButton outreachId={outreach.id} />}
        </div>

        {can(company, "agent.use") && <AskAgentAboutOutreach outreach={outreach} />}

        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-xs font-medium text-muted-foreground">Your message</h2>
          <PlainMessage text={outreach.message} />
        </section>

        <section className="flex flex-col gap-2 rounded-xl border p-4" aria-label="Answer">
          <h2 className="text-xs font-medium text-muted-foreground">Answer</h2>
          <Answer outreach={outreach} />
        </section>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
