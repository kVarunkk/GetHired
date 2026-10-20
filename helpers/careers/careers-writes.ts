import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/utils/types/database.types";
import { careersRpcError, currentCareersSlug, revalidateCareers } from "./careers-rpc";
import { careersPageSchema, type CareersPageInput } from "./page-schema";
import { validateSlug } from "./slug";

// The careers page writes, shared by the settings actions and the recruiter
// agent. Callers check careers.edit; the RPCs check it again (CP-SEC-004).

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * CP-REQ-001/002: changes the careers page address. The old one keeps
 * redirecting and stays reserved for 90 days (claim_careers_slug).
 */
export async function claimCareersSlug(
  supabase: SupabaseClient<Database>,
  companyId: string,
  input: string,
): Promise<Result<{ slug: string }>> {
  const valid = validateSlug(input);
  if (!valid.ok) return { ok: false, error: valid.error };

  const previous = await currentCareersSlug(supabase, companyId);
  if (previous === valid.slug) return { ok: true, slug: valid.slug };

  const { data, error } = await supabase.rpc("claim_careers_slug", { p_slug: valid.slug });
  const failed = careersRpcError(data, error);
  if (failed) return { ok: false, error: failed };

  revalidateCareers(companyId, previous, valid.slug);
  return { ok: true, slug: valid.slug };
}

/**
 * CP-REQ-004/009, CP-SEC-002/003: saves the page's accent, cover, sections
 * and links. Validated here (markdown, https links, a contrast-checked
 * #rrggbb accent) and bounded again by save_careers_page.
 */
export async function saveCareersPage(
  supabase: SupabaseClient<Database>,
  companyId: string,
  input: CareersPageInput,
): Promise<Result> {
  const parsed = careersPageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the careers page details." };
  const { accentColor, coverUrl, sections, links } = parsed.data;

  // The generated types make every RPC argument non-null; null clears the accent or cover.
  const { data, error } = await supabase.rpc("save_careers_page", {
    p_accent_color: accentColor as string,
    p_cover_url: coverUrl as string,
    p_sections: sections as unknown as Json,
    p_links: links as Json,
  });
  const failed = careersRpcError(data, error);
  if (failed) return { ok: false, error: failed };

  revalidateCareers(companyId, await currentCareersSlug(supabase, companyId));
  return { ok: true };
}

/** CP-REQ-008: publishes or unpublishes the careers page. */
export async function setCareersPublished(
  supabase: SupabaseClient<Database>,
  companyId: string,
  published: boolean,
): Promise<Result> {
  const { data, error } = await supabase.rpc("set_careers_published", { p_published: published });
  const failed = careersRpcError(data, error);
  if (failed) return { ok: false, error: failed };

  revalidateCareers(companyId, await currentCareersSlug(supabase, companyId));
  return { ok: true };
}
