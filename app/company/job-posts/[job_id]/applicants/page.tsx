import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Error from "@/components/Error";
import FunnelStrip from "@/components/pipeline/FunnelStrip";
import PipelineBoard from "@/components/pipeline/PipelineBoard";
import PipelineList from "@/components/pipeline/PipelineList";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { loadBoard } from "@/helpers/pipeline/board";
import { getJobFunnel } from "@/helpers/pipeline/funnel";
import { RECRUITER_CANDIDATE_COLUMNS } from "@/helpers/profiles/candidate-columns";
import { createClient } from "@/lib/supabase/server";
import type { PipelineBoardData } from "@/utils/types/pipeline.types";
import { cn } from "@/utils/utils";

/**
 * A job's applicants (PL-TASK-004, PL-TASK-010): the funnel strip and the
 * List or Board view (`?view=list|board`). The job page links here.
 */
export default async function JobApplicantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ job_id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  try {
    const { job_id } = await params;
    if (!isUuid(job_id)) notFound();
    const view = (await searchParams).view === "board" ? "board" : "list";

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company) notFound();

    // Scoped to the session company: another company's job is a 404.
    const { data: job, error } = await supabase
      .from("job_postings")
      .select(
        `
          id,
          title,
          company_id,
          applications(*, user_info(${RECRUITER_CANDIDATE_COLUMNS}), job_postings(*), application_screenings(status, fit_score, recommendation))
        ` as const,
      )
      .eq("id", job_id)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw error;
    if (!job) notFound();

    const [{ data: stages, error: stagesError }, { data: templates }, funnel] = await Promise.all([
      supabase
        .from("pipeline_stages")
        .select("id, name, kind")
        .eq("company_id", company.id)
        .eq("archived", false)
        .order("position", { ascending: true }),
      supabase
        .from("company_email_templates")
        .select("id, purpose, name, subject, body_md, is_default")
        .eq("company_id", company.id)
        .order("name", { ascending: true }),
      // The funnel strip (PL-TASK-050). It's extra: a failure only hides it.
      getJobFunnel(supabase, job.id).catch((err) => {
        console.error("Failed to load the job funnel:", err);
        return null;
      }),
    ]);
    if (stagesError) throw stagesError;

    let board: PipelineBoardData | null = null;
    if (view === "board") {
      const result = await loadBoard({ supabase, company }, job.id);
      if (!result.ok) notFound();
      board = result.data;
    }

    const applications = job.applications ?? [];

    return (
      <div className="mb-20 flex w-full flex-col gap-6 p-4">
        <Link
          href={`/company/job-posts/${job.id}`}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the job
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[28px]">
              Applicants ({applications.length})
            </h1>
            <p className="text-muted-foreground [overflow-wrap:anywhere]">{job.title}</p>
          </div>
          <nav aria-label="Applicants view" className="flex rounded-md border p-0.5 text-sm">
            {(["list", "board"] as const).map((option) => (
              <Link
                key={option}
                href={`?view=${option}`}
                aria-current={view === option ? "page" : undefined}
                className={cn(
                  "rounded px-3 py-1 capitalize text-muted-foreground",
                  view === option && "bg-muted font-medium text-foreground",
                )}
              >
                {option}
              </Link>
            ))}
          </nav>
        </div>

        {funnel && funnel.total > 0 && <FunnelStrip stages={funnel.stages} />}

        {board ? (
          <PipelineBoard jobPostId={job.id} initial={board} templates={templates ?? []} />
        ) : (
          <PipelineList
            data={applications}
            jobPostId={job.id}
            stages={stages ?? []}
            templates={templates ?? []}
          />
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
