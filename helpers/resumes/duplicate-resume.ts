import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { RESUME_LIMITS } from "@/helpers/resume/config";
import { PostHogEvent } from "@/utils/types";
import { RESUME_LIMIT_ERROR, hasRoomForResume } from "./resume-limit";
import { upgradeResumeFromFile } from "./upgrade-resume";

export type DuplicateResumeResult = { ok: true; resumeId: string } | { ok: false; error: string };

const NOT_FOUND = "Resume not found.";
const COPY_SUFFIX = " (copy)";

const copyName = (name: string | null) =>
  `${(name ?? "Untitled resume").slice(0, RESUME_LIMITS.shortFieldChars - COPY_SUFFIX.length)}${COPY_SUFFIX}`;

/**
 * Copies a resume, keeping its section, item and bullet ids so a review of the
 * source still points at the right bullets (RE-REQ-040, RE-REQ-041). A version
 * 1 source upgrades first, so a copy is always version 2 (RE-REQ-095).
 */
export async function duplicateResume(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  { resumeId, name }: { resumeId: string; name?: string },
): Promise<DuplicateResumeResult> {
  const readSource = () =>
    supabase
      .from("resumes")
      .select("id, name, content, contact, template, revision, schema_version, resume_path")
      .eq("id", resumeId)
      .eq("user_id", user.id)
      .maybeSingle();

  let { data: source, error: readError } = await readSource();
  if (readError) throw new Error(`Failed to read the resume: ${readError.message}`);
  if (!source) return { ok: false, error: NOT_FOUND };

  if (!(await hasRoomForResume(supabase, user.id))) return { ok: false, error: RESUME_LIMIT_ERROR };

  if (source.schema_version === 1) {
    const upgraded = await upgradeResumeFromFile(source);
    if (!upgraded.ok) return { ok: false, error: upgraded.error };

    ({ data: source, error: readError } = await readSource());
    if (readError) throw new Error(`Failed to read the resume: ${readError.message}`);
    if (!source) return { ok: false, error: NOT_FOUND };
  }

  const { data: copy, error } = await supabase
    .from("resumes")
    .insert({
      user_id: user.id,
      name: name?.trim() || copyName(source.name),
      content: source.content,
      contact: source.contact,
      template: source.template,
      source_resume_id: source.id,
      schema_version: 2,
      revision: 1,
      is_primary: false,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "We couldn't copy this resume. Please try again." };

  after(() =>
    eventCaptureServer({
      event: PostHogEvent.ResumeDuplicated,
      distinctId: user.id,
      properties: {},
    }),
  );

  return { ok: true, resumeId: copy.id };
}
