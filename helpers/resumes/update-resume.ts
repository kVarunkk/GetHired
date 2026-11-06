import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/utils/types/database.types";
import { readResume } from "@/helpers/resume/read-resume";
import type { ResumeTemplate } from "@/helpers/resume/config";
import { ResumeOperationSchema, applyResumeOperations, type ResumeDraft } from "./resume-operations";
import {
  RESUME_CHANGED,
  RESUME_CHANGED_ERROR,
  saveResume,
  type ResumeSurface,
  type SaveResumeResult,
} from "./save-resume";

/** Enough for a real edit, and a limit on what one approval covers. */
export const RESUME_MAX_OPERATIONS = 50;

export const UpdateResumeInputSchema = z.object({
  resumeId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  operations: z.array(ResumeOperationSchema).min(1).max(RESUME_MAX_OPERATIONS),
});

export type UpdateResumeInput = z.input<typeof UpdateResumeInputSchema>;

type PlanFailure = { ok: false; code: "INVALID" | "NOT_FOUND" | typeof RESUME_CHANGED; error: string };

export type ResumeUpdatePlan =
  | {
      ok: true;
      before: ResumeDraft;
      after: ResumeDraft & { name: string; template: ResumeTemplate };
    }
  | PlanFailure;

/**
 * What the operations would do, without writing anything, for the approval card
 * and MCP's confirmation as well as the update itself (RE-REQ-071, RE-REQ-072).
 * An unknown id or a broken limit fails the whole plan.
 */
export async function planResumeUpdate(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  input: unknown,
): Promise<ResumeUpdatePlan> {
  const parsed = UpdateResumeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID", error: parsed.error.issues[0]?.message ?? "These changes aren't valid." };
  }
  const { resumeId, expectedRevision, operations } = parsed.data;

  const { data: row, error } = await supabase
    .from("resumes")
    .select("id, name, content, contact, template, revision, schema_version")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Failed to read the resume: ${error.message}`);
  if (!row) return { ok: false, code: "NOT_FOUND", error: "Resume not found." };
  if (row.revision !== expectedRevision) return { ok: false, code: RESUME_CHANGED, error: RESUME_CHANGED_ERROR };

  const resume = readResume(row);
  const name = row.name ?? "Untitled resume";
  const before: ResumeDraft = {
    content: resume.content,
    contact: resume.contact ?? { fullName: "", links: [] },
    name,
    template: resume.template,
  };

  const result = applyResumeOperations(before.content, before.contact, operations);
  if (!result.ok) return { ok: false, code: "INVALID", error: result.error };

  return {
    ok: true,
    before,
    after: {
      content: result.content,
      contact: result.contact,
      name: result.name ?? name,
      template: result.template ?? resume.template,
    },
  };
}

/** Applies the operations through `saveResume`, for the agent and MCP. */
export async function updateResume(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  input: UpdateResumeInput,
  { surface }: { surface: ResumeSurface },
): Promise<SaveResumeResult> {
  const plan = await planResumeUpdate(supabase, user, input);
  if (!plan.ok) return plan;

  return saveResume(
    supabase,
    user,
    { resumeId: input.resumeId, expectedRevision: input.expectedRevision, ...plan.after },
    { surface },
  );
}
