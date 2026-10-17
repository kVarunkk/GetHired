import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { AUDIT_PAGE_SIZE, auditDateBounds, toAuditEntry, type AuditEntry, type AuditFilters } from "./audit";

export type AuditPage = { entries: AuditEntry[]; nextBefore: number | null };

/**
 * One page of the session company's audit log, newest first (RP-REQ-015).
 * `list_company_audit` scopes it to the caller's company and returns null
 * without audit.view. Keyset pagination: pass the last page's `nextBefore`.
 */
export async function listAudit(
  supabase: SupabaseClient<Database>,
  filters: AuditFilters,
  before: number | null = null,
): Promise<AuditPage | null> {
  const { since, until } = auditDateBounds(filters);
  const { data, error } = await supabase.rpc("list_company_audit", {
    p_limit: AUDIT_PAGE_SIZE,
    ...(before !== null ? { p_before: before } : {}),
    ...(filters.actor ? { p_actor: filters.actor } : {}),
    ...(filters.action ? { p_action: filters.action } : {}),
    ...(since ? { p_since: since } : {}),
    ...(until ? { p_until: until } : {}),
  });
  if (error) throw new Error(`Failed to load the audit log: ${error.message}`);
  if (data === null) return null;
  const entries = (data as unknown as Parameters<typeof toAuditEntry>[0][]).map(toAuditEntry);
  return {
    entries,
    nextBefore: entries.length === AUDIT_PAGE_SIZE ? entries[entries.length - 1].id : null,
  };
}
