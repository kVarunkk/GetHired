import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { upgradeResumeFromFile } from "./upgrade-resume";

const read = (supabase: SupabaseClient<Database>, userId: string, resumeId: string) =>
  supabase
    .from("resumes")
    .select("id, name, content, contact, template, revision, schema_version, resume_path, created_at, updated_at, is_primary")
    .eq("user_id", userId)
    .eq("id", resumeId)
    .maybeSingle();

/**
 * One of the user's resumes with its parsed content, or null when the user has
 * no resume with that id. Shared by GET /api/resumes/[resume_id], the agent and
 * MCP. `user` must come from the session or tool context.
 *
 * `forEditing` is for the owner's own tools. It adds the contact details
 * (RE-REQ-005), and upgrades a version 1 resume first as opening the editor does
 * (RE-REQ-095), because version 1 has no ids for an edit to name. If that fails,
 * the stored resume comes back and the save reports the failure.
 */
export async function getResumeDetails(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  resumeId: string,
  { forEditing = false }: { forEditing?: boolean } = {},
) {
  const { data, error } = await read(supabase, user.id, resumeId);
  if (error) throw error;
  if (!data) return null;

  let row = data;
  if (forEditing && row.schema_version === 1) {
    const upgraded = await upgradeResumeFromFile(row);
    if (upgraded.ok) {
      const { data: fresh, error: rereadError } = await read(supabase, user.id, resumeId);
      if (rereadError) throw rereadError;
      if (fresh) row = fresh;
    }
  }

  return {
    id: row.id,
    name: row.name,
    content: row.content,
    template: row.template,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_primary: row.is_primary,
    ...(forEditing ? { contact: row.contact } : {}),
  };
}
