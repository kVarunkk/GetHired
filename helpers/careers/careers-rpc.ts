import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { careersCompanyTag, careersSlugTag } from "./cache-tags";
import { careersPath } from "./slug";

// The careers RPCs return { ok, reason }. These are the messages the editor shows.

export type CareersRpcReason = "forbidden" | "invalid" | "taken";

const MESSAGES: Record<CareersRpcReason | "unknown", string> = {
  forbidden: "Your role can't edit the careers page.",
  invalid: "Check the careers page details and try again.",
  taken: "That address is taken. Try another.",
  unknown: "Couldn't save the careers page. Please try again.",
};

export function careersRpcError(data: unknown, error: unknown): string | null {
  if (error) return MESSAGES.unknown;
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  if (r.ok) return null;
  return MESSAGES[(r.reason as CareersRpcReason) ?? "unknown"] ?? MESSAGES.unknown;
}

/** The session company's current slug (RLS read of its own row). */
export async function currentCareersSlug(supabase: SupabaseClient<Database>, companyId: string): Promise<string | null> {
  const { data } = await supabase.from("company_info").select("careers_slug").eq("id", companyId).maybeSingle();
  return data?.careers_slug ?? null;
}

/** CP-CON-001: refresh every cached view of the page after an edit. */
export function revalidateCareers(companyId: string, ...slugs: (string | null | undefined)[]) {
  revalidateTag(careersCompanyTag(companyId));
  for (const slug of new Set(slugs.filter((s): s is string => Boolean(s)))) {
    revalidateTag(careersSlugTag(slug));
    revalidatePath(careersPath(slug));
  }
  revalidatePath("/company/settings/careers");
}
