import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import type { Database, Tables } from "@/utils/types/database.types";
import { isReservedListSlug, slugifyListName } from "@/utils/talent-list-tabs";

export type TalentList = Tables<"talent_lists">;
export type TalentListSummary = {
  id: string;
  name: string;
  /** The list's tab on /company/profiles: `?tab=<slug>`. */
  slug: string;
  memberCount: number;
  hasCandidate: boolean;
};

type Ctx = { supabase: SupabaseClient<Database>; company: MyCompany };
type Result = { ok: true } | { ok: false; error: string };

const NAME_ERROR = {
  ok: false,
  error: "List names are 1 to 60 characters.",
} as const;
const NOT_FOUND = { ok: false, error: "List not found." } as const;

function cleanName(name: string): string | null {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed.length >= 1 && trimmed.length <= 60 ? trimmed : null;
}

/** Postgres' unique_violation: the company already has a list with this slug. */
const UNIQUE_VIOLATION = "23505";

/** The name and its slug, or why the name can't be used. */
function nameAndSlug(
  name: string,
): { ok: true; name: string; slug: string } | { ok: false; error: string } {
  const clean = cleanName(name);
  if (!clean) return NAME_ERROR;
  const slug = slugifyListName(clean);
  if (!slug)
    return {
      ok: false,
      error: "List names need at least one letter or number.",
    };
  if (isReservedListSlug(slug)) {
    return {
      ok: false,
      error: `"${clean}" is the name of a built-in tab. Pick another name.`,
    };
  }
  return { ok: true, name: clean, slug };
}

const takenError = (name: string) => ({
  ok: false as const,
  error: `You already have a list called "${name}" (or one that differs only in punctuation or case).`,
});

/** The session company's list, or null. */
async function ownList({ supabase, company }: Ctx, listId: string) {
  const { data, error } = await supabase
    .from("talent_lists")
    .select("id")
    .eq("id", listId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the list: ${error.message}`);
  return data;
}

export async function createTalentList(
  { supabase, company }: Ctx,
  name: string,
): Promise<{ ok: true; list: TalentList } | { ok: false; error: string }> {
  const named = nameAndSlug(name);
  if (!named.ok) return named;

  const { data, error } = await supabase
    .from("talent_lists")
    .insert({ company_id: company.id, name: named.name, slug: named.slug })
    .select("*")
    .single();
  if (error?.code === UNIQUE_VIOLATION) return takenError(named.name);
  if (error || !data) return { ok: false, error: "Couldn't create the list." };
  return { ok: true, list: data };
}

export async function renameTalentList(
  { supabase, company }: Ctx,
  listId: string,
  name: string,
): Promise<Result> {
  const named = nameAndSlug(name);
  if (!named.ok) return named;
  if (!isUuid(listId)) return NOT_FOUND;

  const { data, error } = await supabase
    .from("talent_lists")
    .update({ name: named.name, slug: named.slug })
    .eq("id", listId)
    .eq("company_id", company.id)
    .select("id");
  if (error?.code === UNIQUE_VIOLATION) return takenError(named.name);
  if (error) return { ok: false, error: "Couldn't rename the list." };
  return data && data.length > 0 ? { ok: true } : NOT_FOUND;
}

/** Deletes a list and its members. The candidates stay saved. */
export async function deleteTalentList(
  { supabase, company }: Ctx,
  listId: string,
): Promise<Result> {
  if (!isUuid(listId)) return NOT_FOUND;

  const { data, error } = await supabase
    .from("talent_lists")
    .delete()
    .eq("id", listId)
    .eq("company_id", company.id)
    .select("id");
  if (error) return { ok: false, error: "Couldn't delete the list." };
  return data && data.length > 0 ? { ok: true } : NOT_FOUND;
}

/** Lists hold the talent pool: public, filled profiles, like the profiles page shows. */
export const PRIVATE_CANDIDATE_ERROR =
  "This candidate's profile is private, so they can't go on a talent list. If they applied, they're in that job's pipeline.";

/**
 * Adds a talent-pool candidate (a public, filled profile) to one of the
 * company's lists. A private applicant the company can see is refused with
 * PRIVATE_CANDIDATE_ERROR; anyone else is "not found". Adding twice is a no-op.
 */
export async function addToTalentList(
  ctx: Ctx,
  listId: string,
  candidateUserId: string,
): Promise<Result> {
  if (!isUuid(listId)) return NOT_FOUND;
  if (!isUuid(candidateUserId))
    return { ok: false, error: "Candidate not found." };

  if (!(await ownList(ctx, listId))) return NOT_FOUND;

  // RLS returns the row only for a candidate the company can view.
  const { data: candidate, error: viewError } = await ctx.supabase
    .from("user_info")
    .select("is_public, filled")
    .eq("user_id", candidateUserId)
    .maybeSingle();
  if (viewError)
    throw new Error(`Failed to check the candidate: ${viewError.message}`);
  if (!candidate) return { ok: false, error: "Candidate not found." };
  if (!candidate.is_public || !candidate.filled) {
    return { ok: false, error: PRIVATE_CANDIDATE_ERROR };
  }

  const { error } = await ctx.supabase
    .from("talent_list_members")
    .upsert(
      { list_id: listId, candidate_user_id: candidateUserId },
      { onConflict: "list_id,candidate_user_id", ignoreDuplicates: true },
    );
  if (error) return { ok: false, error: "Couldn't add the candidate." };
  return { ok: true };
}

export async function removeFromTalentList(
  ctx: Ctx,
  listId: string,
  candidateUserId: string,
): Promise<Result> {
  if (!isUuid(listId) || !isUuid(candidateUserId)) return NOT_FOUND;
  if (!(await ownList(ctx, listId))) return NOT_FOUND;

  const { error } = await ctx.supabase
    .from("talent_list_members")
    .delete()
    .eq("list_id", listId)
    .eq("candidate_user_id", candidateUserId);
  if (error) return { ok: false, error: "Couldn't remove the candidate." };
  return { ok: true };
}

/**
 * The company's lists, oldest first, with whether `candidateUserId` is in
 * each. `memberCount` counts only members the list's tab shows: public,
 * filled profiles (a member may have gone private since).
 */
export async function listTalentLists(
  { supabase, company }: Ctx,
  { candidateUserId }: { candidateUserId?: string } = {},
): Promise<TalentListSummary[]> {
  const { data, error } = await supabase
    .from("talent_lists")
    .select(
      "id, name, slug, talent_list_members(candidate_user_id, user_info(is_public, filled))",
    )
    .eq("company_id", company.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load the lists: ${error.message}`);

  return (data ?? []).map((list) => ({
    id: list.id,
    name: list.name,
    slug: list.slug,
    memberCount: list.talent_list_members.filter(
      (m) => m.user_info?.is_public && m.user_info.filled,
    ).length,
    hasCandidate:
      !!candidateUserId &&
      list.talent_list_members.some(
        (m) => m.candidate_user_id === candidateUserId,
      ),
  }));
}

/** The id of the session company's list with this slug (its tab), or null. */
export async function findTalentListIdBySlug(
  { supabase, company }: Ctx,
  slug: string,
): Promise<string | null> {
  if (!slug || isReservedListSlug(slug)) return null;
  const { data, error } = await supabase
    .from("talent_lists")
    .select("id")
    .eq("company_id", company.id)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the list: ${error.message}`);
  return data?.id ?? null;
}
