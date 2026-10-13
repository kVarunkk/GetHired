"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { UIMessage } from "ai";
import { ArrowUp, Brain } from "lucide-react";
import MessageParts from "@/components/agent/MessageParts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { agentPromptHref, savePendingPrompt } from "@/helpers/agent/prompt-draft";

// A sample /agent conversation for the landing-page hero. It renders the
// agent's own MessageParts with canned messages, so it looks and behaves like
// the real chat (hover, links, "show more"), but it never calls the agent
// API: sending from the composer opens /agent with the typed text in its
// message box, and a suggested reply opens it with that reply.

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

const SAMPLE_JOBS = [
  {
    id: "sample-1",
    title: "Senior Frontend Engineer",
    company: "Lumen Labs",
    locations: ["Remote", "Bengaluru"],
    salary: "₹38L – ₹52L",
    postedAt: daysAgo(1),
    url: "/jobs",
  },
  {
    id: "sample-2",
    title: "Frontend Engineer, Payments",
    company: "Northwind Pay",
    locations: ["Remote"],
    salary: "₹32L – ₹45L",
    postedAt: daysAgo(2),
    url: "/jobs",
  },
  {
    id: "sample-3",
    title: "React Developer",
    company: "Fieldnote",
    locations: ["Remote", "Pune"],
    salary: "₹30L – ₹40L",
    postedAt: daysAgo(4),
    url: "/jobs",
  },
  {
    id: "sample-4",
    title: "Full Stack Engineer (React, Node)",
    company: "Orbit Health",
    locations: ["Remote"],
    salary: "₹34L – ₹48L",
    postedAt: daysAgo(6),
    url: "/jobs",
  },
];

const REPLY = `I found **4 remote React roles** that fit your resume and your ₹30L minimum. Two stand out:

- **Senior Frontend Engineer at Lumen Labs** wants React, TypeScript and design-system work, which lines up with the component library on your resume.
- **Frontend Engineer, Payments at Northwind Pay** is looking for someone who has shipped checkout flows, like your last role.

Want me to review your resume against one of them before you apply?`;

const MESSAGES: UIMessage[] = [
  {
    id: "demo-user",
    role: "user",
    parts: [
      {
        type: "text",
        text: "Find remote React jobs that fit my resume. I want at least ₹30L.",
      },
    ],
  },
  {
    id: "demo-reply",
    role: "assistant",
    parts: [
      {
        type: "tool-getMyProfile",
        toolCallId: "demo-profile",
        state: "output-available",
        input: {},
        output: {},
      },
      {
        type: "tool-findRelevantJobs",
        toolCallId: "demo-jobs",
        state: "output-available",
        input: {},
        output: { jobs: SAMPLE_JOBS, totalCount: 4 },
      },
      { type: "text", text: REPLY },
    ],
  },
];

const SUGGESTIONS = [
  "Review my resume",
  "Save the top two",
  "Only show jobs posted this week",
];

const noop = () => {};

export default function AgentHeroDemo() {
  const router = useRouter();
  const [input, setInput] = useState("");

  return (
    <section
      aria-label="Example conversation with the GetHired agent"
      className="flex h-[34rem] w-full flex-col overflow-hidden rounded-xl border bg-background text-left sm:h-[38rem]"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3 sm:px-4">
        <p className="truncate text-sm font-medium">Remote React roles</p>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <Link href="/agent">
            <Brain className="h-4 w-4" />
            Memories
          </Link>
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
        <div className="mx-auto flex max-w-[46rem] flex-col gap-8 py-8">
          {MESSAGES.map((message) =>
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
                  {SUGGESTIONS.map((suggestion) => (
                    <Link
                      key={suggestion}
                      href={agentPromptHref(suggestion)}
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
          router.push(agentPromptHref(input));
        }}
      >
        <div className="mx-auto flex max-w-[46rem] items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm transition-colors focus-within:border-foreground/30">
          <Textarea
            aria-label="Message"
            value={input}
            rows={1}
            placeholder="Ask about jobs, your resume or applications…"
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
