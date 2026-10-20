import { notFound, permanentRedirect } from "next/navigation";
import { isUuid } from "@/helpers/agent/auth";
import { careersPath } from "@/helpers/careers/slug";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * The old company profile page. A company's public page is now its careers
 * page; this route stays so stored `job_postings.company_url` values and
 * old external links keep working.
 */
export default async function CompanyIdPage({
  params,
}: {
  params: Promise<{ company_id: string }>;
}) {
  const { company_id } = await params;
  if (!isUuid(company_id)) notFound();

  const { data } = await createPublicClient()
    .from("company_info")
    .select("careers_slug, careers_published")
    .eq("id", company_id)
    .maybeSingle();

  if (!data?.careers_published || !data.careers_slug) notFound();
  permanentRedirect(careersPath(data.careers_slug));
}
