import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";
import {
  agentApplicationInput,
  loadApplicationTarget,
  notReadyReason,
  toFormAnswers,
} from "@/helpers/applications/agent-application";
import { answersView } from "@/helpers/applications/answers-view";
import { fieldViews } from "@/helpers/applications/field-views";
import { validateAnswers } from "@/helpers/applications/validate-answers";

export type PreviewAgentApplicationResult =
  | {
      ok: true;
      job: { title: string | null; company: string | null };
      resume: string | null;
      answers: { key: string; label: string; text: string | null }[];
    }
  | { ok: false; error: string; fieldErrors?: { label: string; error: string }[] };

/**
 * What a proposed `submitApplication` call would send: the job, the resume
 * and each answer under the question's own label (from the database, not
 * the model). Runs the same checks as the submit, so an application that
 * would fail says so here first. Writes nothing. Shared by the agent's
 * approval card and MCP's confirmation; `user` must come from the session
 * or tool context.
 */
export async function previewAgentApplication(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  input: unknown,
): Promise<PreviewAgentApplicationResult> {
  const parsed = agentApplicationInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't read this application." };
  const { jobId, resumeId, answers } = parsed.data;

  try {
    const loaded = await loadApplicationTarget(supabase, user.id, { jobId, resumeId });
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const { target } = loaded;
    const notReady = notReadyReason(target);
    if (notReady) return { ok: false, error: notReady };

    const checked = validateAnswers(target.form, toFormAnswers(target.form, answers));
    if (!checked.ok) {
      const labels = new Map(fieldViews(target.form).map((f) => [f.key, f.label]));
      return {
        ok: false,
        error: checked.formError ?? "Some answers need fixing.",
        fieldErrors: Object.entries(checked.fieldErrors).map(([key, error]) => ({
          label: labels.get(key) ?? key,
          error,
        })),
      };
    }

    return {
      ok: true,
      job: { title: target.title, company: target.company },
      resume: target.resume?.name ?? null,
      answers: answersView({ answers_v2: checked.answers, form_snapshot: target.form }, null).map(
        ({ key, label, text }) => ({ key, label, text }),
      ),
    };
  } catch (error) {
    reportError("[agent apply preview]", error);
    return { ok: false, error: "Couldn't load the preview." };
  }
}
