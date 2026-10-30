import "server-only";
import type { Json } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { SavedMapping } from "./map-columns";

/**
 * Remembers the mapping for a header set (BI-REQ-011/015a), on confirm. The
 * browser can't write `candidate_import_mappings`, so this uses the service
 * role: call it after the permission check, with the session's company.
 * Extra: a failure is logged, never fails the import.
 */
export async function saveImportMapping(companyId: string, headerHash: string, mapping: SavedMapping): Promise<void> {
  const { error } = await createServiceRoleClient()
    .from("candidate_import_mappings")
    .upsert(
      { company_id: companyId, header_hash: headerHash, mapping: mapping as unknown as Json, updated_at: new Date().toISOString() },
      { onConflict: "company_id,header_hash" },
    );
  if (error) reportError("[import] couldn't save the column mapping", error.message);
}
