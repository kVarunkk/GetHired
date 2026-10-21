"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Brain } from "lucide-react";
import MessageParts from "@/components/agent/MessageParts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  COMPANY_AGENT_PATH,
  agentPromptHref,
  savePendingPrompt,
} from "@/helpers/agent/prompt-draft";
import { createClient } from "@/lib/supabase/client";
import { APPLICANT_DEMO, type AgentDemo } from "./agent-demos";

// A sample agent conversation for a landing-page hero. It renders the
// agent's own MessageParts with canned messages, so it looks and behaves like
// the real chat (hover, links, "show more"), but it never calls the agent
// API: sending from the composer opens the demo's agent with the typed text in
// its message box, and a suggested reply opens it with that reply.

const noop = () => {};

/**
 * The login page for a signed-out visitor, returning to `href` afterwards.
 * Linking there directly matters: going through the agent would make the
 * middleware redirect to login, and the client router would cache that
 * redirect for the agent's path, so the soft push back to it after login
 * would land on the login page again.
 */
function loginHref(agentPath: string, href: string) {
  const params = new URLSearchParams();
  if (agentPath === COMPANY_AGENT_PATH) params.set("company", "true");
  params.set("returnTo", href);
  return `/auth/login?${params}`;
}

export default function AgentHeroDemo({ demo = APPLICANT_DEMO }: { demo?: AgentDemo }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  // null until the session is read (from cookies, no request).
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (!cancelled) setSignedIn(!!data.session);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const hrefFor = (text: string) => {
    const href = agentPromptHref(text, demo.agentPath);
    return signedIn === false ? loginHref(demo.agentPath, href) : href;
  };

  return (
    <section
      aria-label={demo.label}
      className="flex h-[34rem] w-full flex-col overflow-hidden rounded-xl border bg-background text-left sm:h-[38rem]"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3 sm:px-4">
        <p className="truncate text-sm font-medium">{demo.title}</p>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <Link href={hrefFor("")} prefetch={false}>
            <Brain className="h-4 w-4" />
            Memories
          </Link>
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
        <div className="mx-auto flex max-w-[46rem] flex-col gap-8 py-8">
          {demo.messages.map((message) =>
            message.role === "user" ? (
              <div
                key={message.id}
                className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[15px] leading-7 text-neutral-700 dark:text-neutral-300"
              >
                <MessageParts message={message} onApprove={noop} onToolOutput={noop} />
              </div>
            ) : (
              <div key={message.id} className="flex flex-col gap-4">
                <MessageParts message={message} onApprove={noop} onToolOutput={noop} />
                <div
                  role="group"
                  aria-label="Suggested replies"
                  className="flex flex-wrap gap-2"
                >
                  {demo.suggestions.map((suggestion) => (
                    <Link
                      key={suggestion}
                      href={hrefFor(suggestion)}
                      prefetch={false}
                      onClick={() => savePendingPrompt(suggestion)}
                      className="rounded-full border px-3.5 py-1.5 text-left text-sm transition-colors hover:border-brand/40 hover:bg-brandSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                    >
                      {suggestion}
                    </Link>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      <form
        className="px-4 pb-4 sm:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          // Saved too, so the text survives a detour through login.
          savePendingPrompt(input);
          router.push(hrefFor(input));
        }}
      >
        <div className="mx-auto flex max-w-[46rem] items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm transition-colors focus-within:border-foreground/30">
          <Textarea
            aria-label="Message"
            value={input}
            rows={1}
            placeholder={demo.placeholder}
            className="max-h-48 min-h-10 resize-none border-0 bg-transparent px-2 py-2 text-[15px] leading-6 shadow-none [field-sizing:content] focus-visible:ring-0 focus-visible:ring-offset-0"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            variant="brand"
            aria-label="Send"
            className="shrink-0 rounded-xl"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </section>
  );
}
