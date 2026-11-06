import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/utils/types/database.types";
import { resumeSectionText } from "@/helpers/embeddings/resume-text";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { reportError } from "@/helpers/posthog/report-error";
import { RESUME_LIMITS, RESUME_TEMPLATES, type ResumeTemplate } from "@/helpers/resume/config";
import {
  ResumeContactSchema,
  ResumeContentSchema,
  type ResumeContact,
  type ResumeContent,
} from "@/helpers/resume/resume-schema";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { PostHogEvent } from "@/utils/types";
import { upgradeResumeFromFile } from "./upgrade-resume";

/** Someone else changed the resume since it was read: read it again (RE-REQ-033). */
export const RESUME_CHANGED = "RESUME_CHANGED";
export const RESUME_CHANGED_ERROR = "This resume changed since you opened it. Reload to see the latest version.";

export type ResumeSurface = "page" | "agent" | "mcp";

export const SaveResumeInputSchema = z.object({
  resumeId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  contact: ResumeContactSchema,
  content: ResumeContentSchema,
  name: z.string().trim().min(1, "Give this resume a name.").max(RESUME_LIMITS.shortFieldChars),
  template: z.enum(RESUME_TEMPLATES),
});

export type SaveResumeInput = {
  resumeId: string;
  expectedRevision: number;
  contact: ResumeContact;
  content: ResumeContent;
  name: string;
  template: ResumeTemplate;
};

export type SaveResumeResult =
  | { ok: true; revision: number }
  | { ok: false; code: "INVALID"; error: string }
  | { ok: false; code: "NOT_FOUND"; error: string }
  | { ok: false; code: "UPGRADE_FAILED"; error: string }
  | { ok: false; code: typeof RESUME_CHANGED; error: string };

/** The sections embeddings read (RE-REQ-034). */
const EMBEDDED_SECTIONS = ["experience", "projects", "skills"];

const embeddedTextChanged = (before: unknown, after: unknown) =>
  EMBEDDED_SECTIONS.some((type) => resumeSectionText(before, type) !== resumeSectionText(after, type));

/**
 * The one write path for a resume, for the page, the agent and MCP
 * (RE-REQ-033). The update is conditional on the revision the caller read, so
 * it can't overwrite a change it hasn't seen. `user` comes from the session or
 * tool context, and every query is limited to them (RE-SEC-002).
 */
export async function saveResume(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  input: SaveResumeInput,
  { surface = "page" }: { surface?: ResumeSurface } = {},
): Promise<SaveResumeResult> {
  const parsed = SaveResumeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID", error: parsed.error.issues[0]?.message ?? "This resume isn't valid." };
  }
  const { resumeId, expectedRevision, contact, content, name, template } = parsed.data;

  const { data: current, error: readError } = await supabase
    .from("resumes")
    .select("id, name, content, is_primary, revision, schema_version, resume_path")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) throw new Error(`Failed to read the resume: ${readError.message}`);
  if (!current) return { ok: false, code: "NOT_FOUND", error: "Resume not found." };

  // RE-REQ-095: the caller's text is version 1, and the upgrade replaces it. It
  // gets RESUME_CHANGED to read the upgraded resume, so its edits can't land on
  // top of a re-parse it hasn't seen.
  if (current.schema_version === 1) {
    const upgraded = await upgradeResumeFromFile(current);
    if (!upgraded.ok) return { ok: false, code: "UPGRADE_FAILED", error: upgraded.error };
    return { ok: false, code: RESUME_CHANGED, error: RESUME_CHANGED_ERROR };
  }

  const revision = expectedRevision + 1;
  const { data: saved, error: saveError } = await supabase
    .from("resumes")
    .update({
      contact: contact as unknown as Json,
      content: content as unknown as Json,
      name,
      template,
      revision,
      updated_at: new Date().toISOString(),
    })
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .eq("revision", expectedRevision)
    .select("id")
    .maybeSingle();
  if (saveError) throw new Error(`Failed to save the resume: ${saveError.message}`);
  if (!saved) return { ok: false, code: RESUME_CHANGED, error: RESUME_CHANGED_ERROR };

  const shouldEmbed = current.is_primary && embeddedTextChanged(current.content, content);
  after(async () => {
    if (shouldEmbed) {
      const embedded = await updateUserEmbedding(user.id);
      if (embedded.error) reportError("[RESUME_SAVE_EMBED_FAILED]:", embedded.error);
    }
    await eventCaptureServer({
      event: PostHogEvent.ResumeSaved,
      distinctId: user.id,
      properties: { surface },
    });
  });

  return { ok: true, revision };
}
