import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import AgentShell from "@/components/agent/AgentShell";
import { loadAgentPageData } from "@/helpers/agent/page-data";
import { countUserMessagesToday } from "@/helpers/agent/persistence";
import { AGENT_PATH, COMPANY_AGENT_PATH, readPromptParam } from "@/helpers/agent/prompt-draft";
import type { AgentRoleId } from "@/helpers/agent/roles/types";
import { getMyCompany } from "@/helpers/companies/get-my-company";

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
    if (accountRole !== role) {
      redirectTo = accountRole === "company" ? COMPANY_AGENT_PATH : AGENT_PATH;
    } else if (role === "company" && !(await getMyCompany(supabase, user))) {
      redirectTo = "/get-started?company=true";
    } else {
      const { session, prompt: promptParam } = await searchParams;
      const prompt = readPromptParam(promptParam);
      const [pageData, messagesUsedToday] = await Promise.all([
        loadAgentPageData(supabase, user.id, session, { newChat: prompt !== "", role }),
        countUserMessagesToday(supabase, user.id, new Date()),
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
          />
        );
      }
    }
  } catch {
    return <ErrorComponent />;
  }
  // redirect() and notFound() throw, so they're called outside the try,
  // which would catch them. A session that isn't the user's is a 404.
  if (redirectTo) redirect(redirectTo);
  notFound();
}
