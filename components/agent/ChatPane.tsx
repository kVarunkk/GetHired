"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import {
  AlertCircle,
  FileSearch,
  ListChecks,
  RotateCcw,
  Search,
  Target,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ResumeUploadOutput } from "./ResumeUploadWidget";
import Composer from "./Composer";
import ScrollToBottomButton from "./ScrollToBottomButton";
import MessageParts, { StepNode } from "./MessageParts";

export const SUGGESTED_PROMPTS = [
  "Find remote frontend jobs posted this week",
  "Show jobs that match my profile",
  "Review my resume against a job I like",
  "What's the status of my applications?",
];

/** One icon per starter prompt, in the same order: search, match, review, track. */
const STARTER_ICONS: LucideIcon[] = [Search, Target, FileSearch, ListChecks];

/** Within this many px of the bottom counts as "at the latest message". */
const NEAR_BOTTOM_PX = 80;

const GENERIC_ERROR = "Something went wrong. Please try again.";

/** The chat request body: only the newest message is sent (spec §4.7). */
export const buildChatRequest =
  (sessionId: string) =>
  ({
    messages,
    trigger,
    messageId,
  }: {
    messages: UIMessage[];
    trigger: "submit-message" | "regenerate-message";
    messageId: string | undefined;
  }) => ({
    body:
      trigger === "submit-message"
        ? { sessionId, trigger, messageId, message: messages.at(-1) }
        : { sessionId, trigger, messageId },
  });

/** The suggested replies the server attached to a message, if any. */
function suggestionsOf(message: UIMessage): string[] {
  const part = message.parts.findLast((p) => p.type === "data-suggestions") as
    { data?: { suggestions?: unknown } } | undefined;
  const suggestions = part?.data?.suggestions;
  return Array.isArray(suggestions)
    ? suggestions.filter(
        (s): s is string => typeof s === "string" && s.trim() !== "",
      )
    : [];
}

/** The server's `{ error }` message from a failed chat request, if any. */
export function chatErrorMessage(error: Error) {
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : GENERIC_ERROR;
  } catch {
    return GENERIC_ERROR;
  }
}

export default function ChatPane({
  sessionId,
  initialMessages,
  onFinish,
}: {
  sessionId: string;
  initialMessages: UIMessage[];
  onFinish?: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // The ref drives auto-scroll without re-rendering; the state drives the button.
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agent/chat",
        prepareSendMessagesRequest: buildChatRequest(sessionId),
      }),
    [sessionId],
  );

  const {
    messages,
    status,
    error,
    sendMessage,
    regenerate,
    stop,
    addToolApprovalResponse,
    addToolOutput,
  } = useChat({
    id: sessionId,
    messages: initialMessages,
    transport,
    // Continue automatically once approvals are answered or the upload finishes.
    sendAutomaticallyWhen: (options) =>
      lastAssistantMessageIsCompleteWithApprovalResponses(options) ||
      lastAssistantMessageIsCompleteWithToolCalls(options),
    onFinish: () => onFinish?.(),
  });

  const busy = status === "submitted" || status === "streaming";
  const lastAssistantId = [...messages]
    .reverse()
    .find((m) => m.role === "assistant")?.id;

  // Follow new output only while the user is at the bottom, so reading
  // earlier messages during a reply isn't interrupted.
  useEffect(() => {
    if (atBottomRef.current) endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, status]);

  const handleScroll = useCallback(() => {
    const log = logRef.current;
    if (!log) return;
    const near =
      log.scrollHeight - log.scrollTop - log.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = near;
    setAtBottom(near);
  }, []);

  const scrollToLatest = useCallback(() => {
    const log = logRef.current;
    log?.scrollTo?.({ top: log.scrollHeight, behavior: "smooth" });
  }, []);

  // Stable callbacks, so memoised messages don't re-render on every update.
  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return false;
      atBottomRef.current = true; // Sending always jumps to the new message.
      sendMessage({ text: trimmed });
      return true;
    },
    [busy, sendMessage],
  );
  const handleApprove = useCallback(
    (response: { id: string; approved: boolean }) =>
      addToolApprovalResponse(response),
    [addToolApprovalResponse],
  );
  const handleToolOutput = useCallback(
    (toolCallId: string, output: ResumeUploadOutput) =>
      addToolOutput({ tool: "requestResumeUpload", toolCallId, output }),
    [addToolOutput],
  );
  const handleStop = useCallback(() => stop(), [stop]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={logRef}
          role="log"
          aria-label="Conversation"
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 sm:px-6"
        >
          <div className="mx-auto flex max-w-[46rem] flex-col gap-8 pb-8 pt-8">
            {messages.length === 0 && (
              <div className="flex flex-col gap-8 pt-6 sm:pt-16">
                <div className="flex flex-col gap-2">
                  <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">
                    What do you need help with?
                  </h2>
                  <p className="max-w-prose text-[15px] leading-7 text-muted-foreground">
                    I can find jobs that fit your profile, review your resume
                    against a role, and keep your applications up to date.
                  </p>
                </div>
                <ul className="divide-y overflow-hidden rounded-xl border">
                  {SUGGESTED_PROMPTS.map((prompt, index) => {
                    const Icon = STARTER_ICONS[index] ?? Search;
                    return (
                      <li key={prompt}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                          onClick={() => send(prompt)}
                        >
                          <Icon
                            aria-hidden
                            className="h-4 w-4 shrink-0 text-muted-foreground"
                          />
                          {prompt}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {messages.map((message) => {
              const isLatestReply = message.id === lastAssistantId && !busy;
              const suggestions = isLatestReply ? suggestionsOf(message) : [];

              return message.role === "user" ? (
                <div
                  key={message.id}
                  className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[15px] leading-7 text-neutral-700 dark:text-neutral-300"
                >
                  <MessageParts
                    message={message}
                    onApprove={handleApprove}
                    onToolOutput={handleToolOutput}
                  />
                </div>
              ) : (
                <div key={message.id} className="flex flex-col gap-4">
                  <MessageParts
                    message={message}
                    onApprove={handleApprove}
                    onToolOutput={handleToolOutput}
                  />
                  {suggestions.length > 0 && (
                    <div
                      role="group"
                      aria-label="Suggested replies"
                      className="flex flex-wrap gap-2 duration-300 animate-in fade-in"
                    >
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          className="rounded-full border px-3.5 py-1.5 text-left text-sm transition-colors hover:border-brand/40 hover:bg-brandSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                          onClick={() => send(suggestion)}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                  {isLatestReply && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="-ml-2 h-8 w-fit text-muted-foreground"
                      onClick={() => regenerate({ messageId: message.id })}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Regenerate
                    </Button>
                  )}
                </div>
              );
            })}

            {busy && (
              <div
                role="status"
                className="relative pl-6 text-sm leading-6 text-muted-foreground"
              >
                <StepNode tone="running" />
                Thinking…
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
              >
                <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                {chatErrorMessage(error)}
              </p>
            )}
            <div ref={endRef} />
          </div>
        </div>
        <ScrollToBottomButton visible={!atBottom} onClick={scrollToLatest} />
      </div>

      <Composer busy={busy} onSend={send} onStop={handleStop} />
    </div>
  );
}
