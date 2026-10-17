"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { AlertCircle, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canRegenerate, withRegeneration } from "@/helpers/agent/regenerations";
import { isStopped, stoppedReply } from "@/helpers/agent/stopped";
import type { ResumeUploadOutput } from "./ResumeUploadWidget";
import Composer from "./Composer";
import ScrollToBottomButton from "./ScrollToBottomButton";
import MessageParts, { StepNode } from "./MessageParts";
import { AGENT_ROLE_UI, APPLICANT_STARTERS, type AgentRoleId } from "./roles";

/** The applicant's starter prompts. */
export const SUGGESTED_PROMPTS = APPLICANT_STARTERS;

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
  role = "applicant",
  sessionId,
  initialMessages,
  initialDraft,
  messagesUsedToday = 0,
  memberCap = null,
  onFinish,
}: {
  role?: AgentRoleId;
  sessionId: string;
  initialMessages: UIMessage[];
  initialDraft?: string;
  /** The user's messages so far today, toward the daily cap. */
  messagesUsedToday?: number;
  /** The member's monthly agent message cap from their role, when capped (RP-REQ-044). */
  memberCap?: { limit: number; remaining: number } | null;
  onFinish?: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // The ref drives auto-scroll without re-rendering; the state drives the button.
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  // Messages sent since `messagesUsedToday` was last loaded; the page reloads
  // it after each reply, which starts this count again.
  const [usage, setUsage] = useState({ loaded: messagesUsedToday, sent: 0 });
  if (usage.loaded !== messagesUsedToday) setUsage({ loaded: messagesUsedToday, sent: 0 });
  const ui = AGENT_ROLE_UI[role];
  const dailyCapReached = usage.loaded + usage.sent >= ui.dailyCap;
  // Reloaded with messagesUsedToday, so `sent` counts from the same point.
  const capLeft = memberCap ? Math.max(memberCap.remaining - usage.sent, 0) : null;

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
    setMessages,
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
    onFinish: ({ message, isAbort }) => {
      // Show a stopped reply the way the server saves it (helpers/agent/stopped.ts).
      if (isAbort) {
        setMessages((current) =>
          current.flatMap((m) => {
            if (m.id !== message.id) return [m];
            const reply = stoppedReply(m);
            return reply ? [reply] : [];
          }),
        );
      }
      onFinish?.();
    },
  });

  const busy = status === "submitted" || status === "streaming";
  // The reply being streamed right now, whose new words fade in.
  const streamingId =
    status === "streaming" && messages.at(-1)?.role === "assistant" ? messages.at(-1)!.id : null;
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
      setUsage((current) => ({ ...current, sent: current.sent + 1 }));
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
  // Counts the regeneration on the user message the way the server saves it,
  // so the button goes away after the last one allowed.
  const handleRegenerate = useCallback(
    (replyId: string, parentId: string) => {
      setMessages((current) =>
        current.map((m) => (m.id === parentId ? withRegeneration(m) : m)),
      );
      regenerate({ messageId: replyId });
    },
    [regenerate, setMessages],
  );

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
                    {ui.heading}
                  </h2>
                  <p className="max-w-prose text-[15px] leading-7 text-muted-foreground">
                    {ui.intro}
                  </p>
                </div>
                <ul className="divide-y overflow-hidden rounded-xl border">
                  {ui.starters.map((prompt, index) => {
                    const Icon = ui.icons[index] ?? Search;
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

            {messages.map((message, index) => {
              const isLatestReply = message.id === lastAssistantId && !busy;
              const suggestions = isLatestReply ? suggestionsOf(message) : [];
              const parent = isLatestReply
                ? messages.slice(0, index).findLast((m) => m.role === "user")
                : undefined;
              const regenerable =
                parent !== undefined && !dailyCapReached && canRegenerate(parent);

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
                    streaming={message.id === streamingId}
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
                  {isStopped(message) && (
                    <p className="relative pl-6 text-sm leading-6 text-muted-foreground">
                      <StepNode tone="declined" />
                      Response stopped
                    </p>
                  )}
                  {regenerable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="-ml-2 h-8 w-fit text-muted-foreground"
                      onClick={() => handleRegenerate(message.id, parent.id)}
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
                <span className="agent-shimmer">Thinking…</span>
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

      {memberCap && capLeft !== null && (
        <p className="px-4 pb-1 text-center text-xs text-muted-foreground">
          {capLeft} of your {memberCap.limit} agent messages left this month
        </p>
      )}
      <Composer busy={busy} onSend={send} onStop={handleStop} initialDraft={initialDraft} />
    </div>
  );
}
