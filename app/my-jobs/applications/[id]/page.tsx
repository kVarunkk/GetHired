import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import GetHiredDetail from "@/components/tracker/GetHiredDetail";
import TrackedDetail from "@/components/tracker/TrackedDetail";
import { createClient } from "@/lib/supabase/server";
import { loadTrackerDetail } from "@/helpers/tracker/detail";
import { myJobsPath } from "@/helpers/tracker/paths";
import { trackedStatusLabel } from "@/helpers/tracker/status";

export const metadata: Metadata = {
  title: "Application",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const detail = await loadTrackerDetail({ supabase, user: { id: user.id } }, id);
  if (!detail) notFound();

  if (detail.kind === "gethired") {
    return (
      <div className="flex flex-col gap-6 p-4">
        <PageHeader
          title={detail.item.jobTitle}
          description={detail.item.companyName}
          backHref={myJobsPath({ tab: "applications" })}
          backLabel="Back to My Jobs"
        />
        <GetHiredDetail item={detail.item} />
      </div>
    );
  }

  const { row, events } = detail;
  const { data: resumes } = await supabase
    .from("resumes")
    .select("id, name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6 p-4">
      <PageHeader
        title={row.job_title}
        description={`${row.company_name} · ${trackedStatusLabel(row.status)}`}
        backHref={myJobsPath({ tab: row.status === "saved" ? "saved" : "applications" })}
        backLabel="Back to My Jobs"
      />
      <TrackedDetail
        row={{
          id: row.id,
          allJobsId: row.all_jobs_id,
          jobTitle: row.job_title,
          companyName: row.company_name,
          jobUrl: row.job_url,
          location: row.location,
          jobDescription: row.job_description,
          status: row.status,
          appliedAt: row.applied_at,
          nextFollowUpAt: row.next_follow_up_at,
          notes: row.notes,
          contactName: row.contact_name,
          resumeId: row.resume_id,
          salaryAmount: row.salary_amount,
          salaryCurrency: row.salary_currency,
        }}
        events={events}
        resumes={resumes ?? []}
      />
    </div>
  );
}
