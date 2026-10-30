import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { loadImportPage, type ImportPage } from "./import-page";

export type NewCandidatePage = ImportPage;

/**
 * What the add-candidate form needs (BI-REQ-009, CP-REQ-010): the same
 * destinations as the other import methods. With `jobId` (a job page, or
 * `/company/candidates/new?job=` before its redirect) the job is
 * `fixedJob`, or `notFound` when the member can't import into it. Null when
 * the member can't add anyone.
 */
export function loadNewCandidatePage(
  supabase: SupabaseClient<Database>,
  company: MyCompany,
  jobId?: string | null,
): Promise<NewCandidatePage | null> {
  return loadImportPage(supabase, company, { jobId });
}
