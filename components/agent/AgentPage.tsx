import { reportError } from "@/helpers/posthog/report-error";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import AgentShell from "@/components/agent/AgentShell";
import { loadAgentPageData } from "@/helpers/agent/page-data";
import { countUserMessagesToday } from "@/helpers/agent/persistence";
import { AGENT_PATH, COMPANY_AGENT_PATH, readPromptParam } from "@/helpers/agent/prompt-draft";
import type { AgentRoleId } from "@/helpers/agent/roles/types";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { AGENT_USE_FORBIDDEN } from "@/helpers/agent/auth";
import { getMemberLimit } from "@/helpers/billing/entitlements";

export type AgentPageSearchParams = Promise<{ session?: string; prompt?: string | string[] }>;

/**
 * The agent page for one role: /agent for applicants, /company/agent for
 * companies. The middleware routes each role to its own page; this checks
 * again, since the role comes from the account, never from the URL
 * (RA-SEC-001).
 */
export default async function AgentPage({
  role,
  searchParams,
}: {
  role: AgentRoleId;
  searchParams: AgentPageSearchParams;
}) {
  let redirectTo: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const accountRole = user.app_metadata?.type === "company" ? "company" : "applicant";
    const company = accountRole === role && role === "company" ? await getMyCompany(supabase, user) : null;
    if (accountRole !== role) {
      redirectTo = accountRole === "company" ? COMPANY_AGENT_PATH : AGENT_PATH;
    } else if (role === "company" && !company) {
      redirectTo = "/get-started?company=true";
    } else if (role === "company" && !can(company, "agent.use")) {
      // RP-REQ-030: a role without agent.use gets the reason, not the chat.
      return (
        <div className="mx-auto w-full max-w-2xl p-4">
          <div className="rounded-lg border p-6">
            <p className="font-semibold">Agent</p>
            <p className="mt-1 text-sm text-muted-foreground">{AGENT_USE_FORBIDDEN}</p>
          </div>
        </div>
      );
    } else {
      const { session, prompt: promptParam } = await searchParams;
      const prompt = readPromptParam(promptParam);
      const [pageData, messagesUsedToday, memberCap] = await Promise.all([
        loadAgentPageData(supabase, user.id, session, { newChat: prompt !== "", role }),
        countUserMessagesToday(supabase, user.id, new Date()),
        // RP-REQ-044: a company member's own cap, shown under the chat. A
        // failed read just hides the hint.
        company
          ? getMemberLimit(company.id, "agent_messages", user.id).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (pageData) {
        const { sessions, activeSessionId, messages } = pageData;

        return (
          <AgentShell
            role={role}
            initialSessions={sessions}
            activeSessionId={activeSessionId}
            initialMessages={messages}
            initialDraft={prompt}
            messagesUsedToday={messagesUsedToday}
            memberCap={memberCap && { limit: memberCap.limit, remaining: memberCap.remaining }}
          />
        );
      }
    }
  } catch (error) {
    reportError("[agent] page failed", error);
    return <ErrorComponent />;
  }
  // redirect() and notFound() throw, so they're called outside the try,
  // which would catch them. A session that isn't the user's is a 404.
  if (redirectTo) redirect(redirectTo);
  notFound();
}
