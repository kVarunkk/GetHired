import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/utils/types/database.types";
import { applicantMessage } from "./copy";

export type ApplicantActionResult = { ok: true } | { ok: false; error: string };

/** The session applicant's client. Company accounts are refused. */
export async function requireApplicant(): Promise<
  { ok: true; supabase: SupabaseClient<Database> } | { ok: false; error: string }
> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in to continue." };
  if (user.app_metadata?.type === "company") return { ok: false, error: "Only applicants can do this." };
  return { ok: true, supabase: await createClient() };
}

/** Maps an applicant function's `{ ok, reason }` to an action result. */
export function applicantRpcResult(data: unknown, error: unknown): ApplicantActionResult {
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result) return { ok: false, error: applicantMessage("unknown") };
  return result.ok ? { ok: true } : { ok: false, error: applicantMessage(result.reason ?? "unknown") };
}
