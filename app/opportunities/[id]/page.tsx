import { notFound, unstable_rethrow } from "next/navigation";
import AskAgentAboutJob from "@/components/AskAgentAboutJob";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import PlainMessage from "@/components/outreach/PlainMessage";
import RespondForm from "@/components/outreach/RespondForm";
import { isOpen } from "@/helpers/outreach/list";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import type { OutreachStatus } from "@/utils/types/outreach.types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * One outreach (OR-REQ-003/004): the company's message as plain text and the
 * answer form. With a job and an Interested answer, "Apply now" goes to the
 * job's public page (difference 11), unless the posting has closed.
 */
export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) notFound();
    const user = await getUserFromRequest();
    if (!user) notFound();
    const supabase = await createClient();

    // RLS returns only the candidate's own outreach; the filter says the same.
    const { data: outreach, error } = await supabase
      .from("candidate_outreach")
      .select(
        "id, subject, message, status, sent_at, expires_at, job_post_id, company_info(name, logo_url, website), job_postings(title, job_id)",
      )
      .eq("id", id)
      .eq("candidate_user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!outreach) notFound();

    const companyName = outreach.company_info?.name ?? "A company";
    const status = outreach.status as OutreachStatus;
    const open = isOpen({ status, expiresAt: outreach.expires_at });

    let applyHref: string | null = null;
    let openJobId: string | null = null;
    const allJobsId = outreach.job_postings?.job_id;
    if (allJobsId) {
      const { data: listing } = await supabase
        .from("all_jobs")
        .select("id, status")
        .eq("id", allJobsId)
        .maybeSingle();
      if (listing && listing.status === "active") {
        openJobId = listing.id;
        applyHref = `/jobs/${listing.id}?apply=true`;
      }
    }

    return (
      <div className="flex w-full max-w-3xl flex-col gap-6 p-4 mb-20">
        <PageHeader
          backHref="/opportunities"
          backLabel="Back to opportunities"
          eyebrow={`${companyName}${outreach.job_postings?.title ? ` · ${outreach.job_postings.title}` : ""}`}
          title={outreach.subject}
          description={`Sent ${formatDate(outreach.sent_at)}${open ? ` · answer by ${formatDate(outreach.expires_at)}` : ""}`}
        />

        {/* No outreach tools: the agent can only help with the job itself. */}
        {openJobId && (
          <AskAgentAboutJob
            job={{
              id: openJobId,
              job_name: outreach.job_postings?.title ?? null,
              company_name: outreach.company_info?.name ?? null,
            }}
          />
        )}

        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-xs font-medium text-muted-foreground">Message from {companyName}</h2>
          <PlainMessage text={outreach.message} />
        </section>

        <RespondForm
          outreachId={outreach.id}
          companyName={companyName}
          status={status}
          open={open}
          applyHref={applyHref}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
