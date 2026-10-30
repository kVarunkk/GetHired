import "server-only";
import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { createClient } from "@/lib/supabase/server";

/**
 * The session for a job's Import candidates section (CP-REQ-021): a 404
 * unless the member has applicants.import for the job. The loaders check
 * that the job is the company's.
 */
export async function requireJobImport(jobId: string) {
  if (!isUuid(jobId)) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const company = user ? await getMyCompany(supabase, user) : null;
  if (!user || !company || !can(company, "applicants.import", jobId)) notFound();
  return { supabase, user, company };
}

/** The session for the Candidates page's import and add pages. */
export async function requireCandidatesImport() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?company=true");
  const company = await getMyCompany(supabase, user);
  if (!company) notFound();
  return { supabase, user, company };
}
