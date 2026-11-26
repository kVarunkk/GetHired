import type { Metadata } from "next";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import ApplyPage from "@/components/apply/ApplyPage";
import ErrorComponent from "@/components/Error";
import { loadApplyPage } from "@/helpers/applications/apply-page";
import { toSearchParams } from "@/helpers/careers/params";

export const metadata: Metadata = {
  title: "Apply",
  robots: { index: false, follow: false },
};

/**
 * AP-REQ-001: the apply page for a platform job. Dynamic: access depends on
 * the signed-in user, and the source tag comes from the query (AP-REQ-021).
 */
export default async function JobApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ job_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { job_id } = await params;
  const query = toSearchParams(await searchParams);
  try {
    const result = await loadApplyPage(job_id, { query });
    if (result.kind === "not_found") notFound();
    if (result.kind === "redirect") redirect(result.to);
    return (
      <ApplyPage
        job={result.job}
        userId={result.userId}
        source={result.source}
        sourceRef={result.ref}
        doneHref={result.doneHref}
      />
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
