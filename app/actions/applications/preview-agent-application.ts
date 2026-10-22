"use server";

import { reportError } from "@/helpers/posthog/report-error";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
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
 * SERVER ACTION: what the agent's proposed `submitApplication` call would
 * send, for its approval card: the job, the resume and each answer under the
 * question's own label (from the database, not the model). Runs the same
 * checks as the submit, so an application that would fail says so here
 * first. Writes nothing. The applicant comes from the session.
 */
export async function previewAgentApplicationAction(input: unknown): Promise<PreviewAgentApplicationResult> {
  const user = await getUserFromRequest();
  if (!user || user.app_metadata?.type === "company") {
    return { ok: false, error: "Sign in with an applicant account to apply." };
  }

  const parsed = agentApplicationInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't read this application." };
  const { jobId, resumeId, answers } = parsed.data;

  try {
    const loaded = await loadApplicationTarget(await createClient(), user.id, { jobId, resumeId });
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
