import "server-only";
import { z } from "zod";
import { companyAllows } from "@/helpers/companies/require-company";
import type { CompanySessionContext } from "@/helpers/companies/company-session";
import { inviteSkipMessage } from "./copy";
import { MAX_BULK_INVITES } from "./invite";

const inputSchema = z.object({ applicationIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_INVITES) });

export type InvitePreviewApplicant =
  | { id: string; name: string | null; jobTitle: string | null; invite: true; minutes: number }
  | { id: string; name: string | null; jobTitle: string | null; invite: false; message: string };

export type PreviewAgentInterviewInviteResult =
  | { ok: true; applicants: InvitePreviewApplicant[]; totalMinutes: number }
  | { ok: false; error: string };

/**
 * SIT-071: what a proposed `inviteToInterview` call would do: the applicants
 * by name, who'd be skipped and why, and the interview minutes held. Writes
 * nothing; the invite itself checks everything again. Shared by the agent's
 * approval card and MCP's confirmation.
 */
export async function previewAgentInterviewInvite(
  { supabase, company }: CompanySessionContext,
  input: unknown,
): Promise<PreviewAgentInterviewInviteResult> {
  const deniedAll = companyAllows(company, { permission: "interviews.manage" });
  if (deniedAll) return { ok: false, error: deniedAll };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't read these invites." };
  const ids = [...new Set(parsed.data.applicationIds)];

  // RLS: only applications on jobs the member can see.
  const { data: apps, error } = await supabase
    .from("applications")
    .select("id, job_post_id, user_info(full_name), job_postings(title)")
    .in("id", ids);
  if (error) return { ok: false, error: "Couldn't load the applicants." };

  const jobIds = [...new Set((apps ?? []).map((a) => a.job_post_id).filter((j): j is string => !!j))];
  const [{ data: configs }, { data: existing }] = await Promise.all([
    jobIds.length
      ? supabase.from("job_interview_configs").select("job_post_id, enabled, duration_minutes").in("job_post_id", jobIds)
      : Promise.resolve({ data: [] as { job_post_id: string; enabled: boolean; duration_minutes: number }[] }),
    supabase.from("application_interviews").select("application_id").in("application_id", ids),
  ]);
  const configOf = new Map((configs ?? []).map((c) => [c.job_post_id, c]));
  const invited = new Set((existing ?? []).map((e) => e.application_id));
  const appOf = new Map((apps ?? []).map((a) => [a.id, a]));

  const applicants: InvitePreviewApplicant[] = ids.map((id) => {
    const app = appOf.get(id);
    if (!app || !app.job_post_id) {
      return { id, name: null, jobTitle: null, invite: false, message: inviteSkipMessage("not_found") };
    }
    const base = { id, name: app.user_info?.full_name?.trim() || null, jobTitle: app.job_postings?.title ?? null };
    const denied = companyAllows(company, { permission: "interviews.manage", jobId: app.job_post_id });
    if (denied) return { ...base, invite: false, message: denied };
    const config = configOf.get(app.job_post_id);
    if (!config?.enabled) return { ...base, invite: false, message: inviteSkipMessage("disabled") };
    if (invited.has(id)) return { ...base, invite: false, message: inviteSkipMessage("exists") };
    return { ...base, invite: true, minutes: config.duration_minutes };
  });

  return {
    ok: true,
    applicants,
    totalMinutes: applicants.reduce((sum, a) => sum + (a.invite ? a.minutes : 0), 0),
  };
}
