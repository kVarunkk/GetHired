import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect, unstable_rethrow } from "next/navigation";
import ApplyPage from "@/components/apply/ApplyPage";
import CareersShell from "@/components/careers/CareersShell";
import ErrorComponent from "@/components/Error";
import { loadApplyPage } from "@/helpers/applications/apply-page";
import { getCareersPage } from "@/helpers/careers/get-careers-page";
import { readRef, toSearchParams } from "@/helpers/careers/params";
import { careersApplyPath } from "@/helpers/jobs/apply-path";
import { getStaticJobDetails } from "@/helpers/jobs/jobId/get-job-details";

export const metadata: Metadata = {
  title: "Apply",
  robots: { index: false, follow: false },
};

/**
 * AP-REQ-002: the apply page inside the company's careers frame. The job must
 * belong to the page's company; the source is always `careers_page` (AP-REQ-020).
 */
export default async function CareersApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; job_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, job_id } = await params;
  const query = toSearchParams(await searchParams);
  try {
    const found = await getCareersPage(slug);
    if (!found) notFound();
    if ("redirect" in found) permanentRedirect(careersApplyPath(found.redirect, job_id, readRef(query)));
    const { page } = found;

    const job = await getStaticJobDetails(job_id);
    const posting = job?.job_postings?.[0];
    if (!job || !posting || posting.company_id !== page.id) notFound();

    const result = await loadApplyPage(job_id, { query, careers: { slug: page.slug } });
    if (result.kind === "not_found") notFound();
    if (result.kind === "redirect") redirect(result.to);

    return (
      <CareersShell page={page} refQuery={result.ref ? `?ref=${encodeURIComponent(result.ref)}` : ""}>
        <ApplyPage
          framed
          job={result.job}
          userId={result.userId}
          source={result.source}
          sourceRef={result.ref}
          doneHref={result.doneHref}
          backLabel={`Back to ${page.name} careers`}
        />
      </CareersShell>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
