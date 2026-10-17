import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { ALLOWANCE_KEYS, type AllowanceKey } from "./keys";

/** One member's spending this usage period, against their role's caps (RP-REQ-044). */
export type MemberUsageRow = {
  userId: string;
  name: string;
  isOwner: boolean;
  roleName: string | null;
  usage: Partial<Record<AllowanceKey, number>>;
  /** Per-member caps from the role. Owners are never capped (RP-REQ-040). */
  limits: Partial<Record<AllowanceKey, number>>;
};

type Raw = {
  user_id: string;
  name: string | null;
  is_owner: boolean;
  role: { id: string; name: string } | null;
  usage: Record<string, number> | null;
  limits: Record<string, number> | null;
};

function allowances(value: Record<string, number> | null): Partial<Record<AllowanceKey, number>> {
  const out: Partial<Record<AllowanceKey, number>> = {};
  for (const key of ALLOWANCE_KEYS) {
    const n = value?.[key];
    if (typeof n === "number") out[key] = n;
  }
  return out;
}

/**
 * `member_usage()` for the session's company, with the user's RLS client. The
 * RPC returns null without billing.view; so does this. Read failures are
 * logged and shown as no table, so the rest of the billing page still loads.
 */
export async function listMemberUsage(supabase: SupabaseClient<Database>): Promise<MemberUsageRow[] | null> {
  const { data, error } = await supabase.rpc("member_usage", {});
  if (error) {
    console.error("[billing] member_usage", error);
    return null;
  }
  if (!Array.isArray(data)) return null;
  return (data as unknown as Raw[]).map((row) => ({
    userId: row.user_id,
    name: row.name || "Unnamed member",
    isOwner: row.is_owner,
    roleName: row.role?.name ?? null,
    usage: allowances(row.usage),
    limits: row.is_owner ? {} : allowances(row.limits),
  }));
}
