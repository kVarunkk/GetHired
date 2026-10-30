import "server-only";
import { sendOutreachInput } from "@/helpers/agent/roles/recruiter/tools/outreach";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { companyAllows } from "@/helpers/companies/require-company";
import type { CompanySessionContext } from "@/helpers/companies/company-session";
import { outreachStatusFor, type OutreachBadge } from "./list";
import { loadVisibleCandidates } from "@/helpers/profiles/visible-candidates";

export type AgentOutreachPreview = {
  ok: true;
  candidateName: string | null;
  acceptsOutreach: boolean;
  jobTitle: string | null;
  /** False when the job isn't one of the company's: the send would fail. */
  jobFound: boolean;
  /** When the company's newest message to the candidate is still unanswered. */
  openSince: string | null;
  /** This month's outreach allowance; `remaining: null` is unlimited. */
  quota: { remaining: number | null; amount: number | null } | null;
};

export type PreviewAgentOutreachResult = AgentOutreachPreview | { ok: false; error: string };

const NOT_AVAILABLE = "This candidate isn't available to contact.";

/**
 * RAT-053: who a proposed `sendOutreach` goes to (RA-REQ-005): the
 * candidate's name, the job, whether they accept outreach, an unanswered
 * message and the quota left. Sends nothing. Directory columns only, so no
 * contact details. Shared by the agent's approval card and MCP's confirmation.
 */
export async function previewAgentOutreach(
  { supabase, company }: CompanySessionContext,
  input: unknown,
): Promise<PreviewAgentOutreachResult> {
  const denied = companyAllows(company, { permission: "outreach.send" });
  if (denied) return { ok: false, error: denied };

  const parsed = sendOutreachInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't read this message." };
  const { candidateId, jobPostId } = parsed.data;

  const candidates = await loadVisibleCandidates<{
    user_id: string | null;
    full_name: string | null;
    accepts_outreach: boolean | null;
  }>(supabase, [candidateId], "user_id, full_name, accepts_outreach");
  const candidate = candidates.get(candidateId);
  if (!candidate) return { ok: false, error: NOT_AVAILABLE };

  const [job, latest, quota] = await Promise.all([
    jobPostId
      ? supabase
          .from("job_postings")
          .select("id, title")
          .eq("id", jobPostId)
          .eq("company_id", company.id)
          .maybeSingle()
          .then(({ data }) => data)
      : Promise.resolve(null),
    outreachStatusFor({ supabase, company }, [candidateId]).catch(() => ({}) as Record<string, OutreachBadge>),
    getEntitlements(company.id)
      .then((e) => ({ remaining: e.entitlements.outreach.remaining, amount: e.entitlements.outreach.amount }))
      .catch(() => null),
  ]);

  const newest = latest[candidateId];
  return {
    ok: true,
    candidateName: candidate.full_name,
    acceptsOutreach: candidate.accepts_outreach !== false,
    jobTitle: job?.title ?? null,
    jobFound: !jobPostId || job !== null,
    openSince: newest?.status === "sent" ? newest.sentAt : null,
    quota,
  };
}
