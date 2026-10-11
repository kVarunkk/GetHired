import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import AgentShell from "@/components/agent/AgentShell";
import { loadAgentPageData } from "@/helpers/agent/page-data";

export const metadata: Metadata = {
  title: "Agent",
  description: "Chat with your GetHired job-search assistant.",
  robots: { index: false, follow: false },
};

// The middleware only lets applicants reach this page.
export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const { session } = await searchParams;
    const { sessions, activeSessionId, messages } = await loadAgentPageData(
      supabase,
      user.id,
      session,
    );

    return (
      <AgentShell
        initialSessions={sessions}
        activeSessionId={activeSessionId}
        initialMessages={messages}
      />
    );
  } catch {
    return <ErrorComponent />;
  }
}
