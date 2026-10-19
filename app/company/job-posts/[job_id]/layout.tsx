import type { ReactNode } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { format } from "date-fns";
import { FileText, Mic, Pencil, UserCog, Users } from "lucide-react";
import Error from "@/components/Error";
import EntityLayout from "@/components/EntityLayout";
import type { EntityNavItem } from "@/components/EntityNav";
import PageHeader from "@/components/PageHeader";
import DeleteJobPosting from "@/components/DeleteJobPosting";
import FindSuitableProfilesForJobPost from "@/components/FindSuitableProfilesForJobPost";
import { JobStatusSwitch } from "@/components/JobPostingsTable";
import ShareJobPosting from "@/components/ShareJobPosting";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCareersLink } from "@/helpers/careers/my-careers-link";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { jobControls } from "@/helpers/companies/job-scope";
import { can } from "@/helpers/companies/permissions";
import { createClient } from "@/lib/supabase/server";

/**
 * A job post's frame: the sections sidebar (overview, applications, AI
 * interview, hiring team, edit) and the header with the job's controls. Each
 * section page checks its own permission too.
 */
export default async function JobPostLayout({
  params,
  children,
}: {
  params: Promise<{ job_id: string }>;
  children: ReactNode;
}) {
  try {
    const { job_id } = await params;
    if (!isUuid(job_id)) notFound();
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company) notFound();

    const { data: job, error } = await supabase
      .from("job_postings")
      .select("*, company_info(name, website)")
      .eq("id", job_id)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw error;
    // RP-REQ-010: a job the viewer's role doesn't cover is a 404 (the row
    // itself is public, so RLS can't hide it). RP-REQ-016: the controls follow
    // the viewer's permissions on this job; the server refuses them too.
    if (!job || !can(company, "jobs.view", job.id)) notFound();
    const controls = jobControls(company, job.id);
    const careersLink = await getMyCareersLink(supabase, company.id).catch(() => null);

    const base = `/company/job-posts/${job.id}`;
    const items: EntityNavItem[] = [
      { href: base, label: "Overview", icon: <FileText />, exact: true },
      { href: `${base}/applications`, label: "Applications", icon: <Users /> },
    ];
    // SIT-060/061: the AI interview page, for interviews.view on this job.
    if (can(company, "interviews.view", job.id)) {
      items.push({ href: `${base}/interview`, label: "AI interview", icon: <Mic /> });
    }
    // RP-REQ-011: the Hiring team page, for jobs.assign on this job only.
    if (can(company, "jobs.assign", job.id)) {
      items.push({ href: `${base}/hiring-team`, label: "Hiring team", icon: <UserCog /> });
    }
    if (controls.edit) items.push({ href: `${base}/edit`, label: "Edit job post", icon: <Pencil /> });

    return (
      <EntityLayout
        nav={{
          label: "Job post sections",
          title: job.title,
          backHref: "/company/job-posts",
          backLabel: "Job posts",
          items,
        }}
        header={
          <PageHeader
            eyebrow="Job post"
            title={<span className="[overflow-wrap:anywhere]">{job.title}</span>}
            description={
              <>
                at {job.company_info?.name} · Posted on {format(new Date(job.created_at), "PPP")}
              </>
            }
            actions={
              <>
                <JobStatusSwitch job={job} disabled={!controls.publish} />
                <DeleteJobPosting job_posting_id={job.id} is_job_posting_page disabled={!controls.delete} />
                <ShareJobPosting job_id={job.job_id} careersSlug={careersLink?.published ? careersLink.slug : null} />
                <FindSuitableProfilesForJobPost job_post_id={job.id} />
              </>
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
