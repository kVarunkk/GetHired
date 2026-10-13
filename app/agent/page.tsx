import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import AgentShell from "@/components/agent/AgentShell";
import { loadAgentPageData } from "@/helpers/agent/page-data";
import { countUserMessagesToday } from "@/helpers/agent/persistence";
import { readPromptParam } from "@/helpers/agent/prompt-draft";

export const metadata: Metadata = {
  title: "Agent",
  description: "Chat with your GetHired job-search assistant.",
  robots: { index: false, follow: false },
};

// The middleware only lets applicants reach this page.
export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; prompt?: string | string[] }>;
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const { session, prompt: promptParam } = await searchParams;
    const prompt = readPromptParam(promptParam);
    const [pageData, messagesUsedToday] = await Promise.all([
      loadAgentPageData(supabase, user.id, session, { newChat: prompt !== "" }),
      countUserMessagesToday(supabase, user.id, new Date()),
    ]);

    if (pageData) {
      const { sessions, activeSessionId, messages } = pageData;

      return (
        <AgentShell
          initialSessions={sessions}
          activeSessionId={activeSessionId}
          initialMessages={messages}
          initialDraft={prompt}
          messagesUsedToday={messagesUsedToday}
        />
      );
    }
  } catch {
    return <ErrorComponent />;
  }
  // The requested session isn't the user's. notFound() throws, so it's
  // called outside the try, which would catch it.
  notFound();
}
