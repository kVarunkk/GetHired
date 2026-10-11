import { after, NextRequest, NextResponse } from "next/server";
import {
  consumeStream,
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isTextUIPart,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { internalError, readJson, requireApplicant } from "@/helpers/agent/auth";
import {
  AGENT_CONTEXT_WINDOW,
  AGENT_DAILY_MESSAGE_CAP,
  AGENT_FULL_TOOL_OUTPUT_TURNS,
  AGENT_MAX_MESSAGE_CHARS,
  AGENT_MAX_STEPS,
  AGENT_MODEL,
} from "@/helpers/agent/config";
import { dropAbandonedToolCalls, selectContextMessages } from "@/helpers/agent/context";
import { mergeClientUpdates } from "@/helpers/agent/client-updates";
import { listMemories } from "@/helpers/agent/memory";
import {
  countUserMessagesToday,
  loadPromptProfile,
  loadSession,
  setSessionTitle,
  touchSession,
  truncateAfter,
  upsertMessages,
} from "@/helpers/agent/persistence";
import { generateSessionTitle, summariseSession } from "@/helpers/agent/summarise";
import { generateFollowUps } from "@/helpers/agent/suggestions";
import { buildSystemPrompt } from "@/helpers/agent/system-prompt";
import { createAgentTools } from "@/helpers/agent/tools";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

export const maxDuration = 60;

const DEFAULT_TITLE = "New chat";
const STREAM_ERROR_MESSAGE = "Sorry, something went wrong. Please try again.";

const bodySchema = z
  .object({
    sessionId: z.string().uuid(),
    trigger: z.enum(["submit-message", "regenerate-message"]),
    messageId: z.string().min(1).max(100).optional(),
    message: z
      .object({
        id: z.string().min(1).max(100),
        role: z.enum(["user", "assistant"]),
        parts: z.array(z.object({ type: z.string() }).passthrough()).min(1),
      })
      .optional(),
  })
  .refine((body) => body.trigger !== "submit-message" || body.message, {
    message: "message is required to submit",
  });

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

const textOf = (message: UIMessage | undefined) =>
  (message?.parts ?? []).filter(isTextUIPart).map((part) => part.text).join("\n");

/** A user message must be plain text within the size limit. */
function validateUserMessage(message: UIMessage): string | null {
  const textParts = message.parts.filter((part) => part.type === "text");
  if (textParts.length !== message.parts.length) return "Messages can only contain text.";

  const total = textParts.map((part) => part.text).join("").trim().length;
  if (total === 0 || total > AGENT_MAX_MESSAGE_CHARS) {
    return `Messages must be between 1 and ${AGENT_MAX_MESSAGE_CHARS} characters.`;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireApplicant();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest("Invalid request.");
  const { sessionId, trigger, messageId } = parsed.data;
  const incoming = parsed.data.message as UIMessage | undefined;

  if (incoming?.role === "user") {
    const invalid = validateUserMessage(incoming);
    if (invalid) return badRequest(invalid);
  }

  try {
    const loaded = await loadSession(supabase, user.id, sessionId);
    if (!loaded) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
    const { session } = loaded;
    let history = loaded.messages;
    let toSave: UIMessage | null = null;

    if (trigger === "regenerate-message") {
      // Regenerate: drop everything after the user message being answered.
      const anchor = messageId
        ? history.findIndex((m) => m.id === messageId)
        : history.length - 1;
      const userIndex = history.findLastIndex((m, i) => i <= anchor && m.role === "user");
      if (anchor === -1 || userIndex === -1) return badRequest("Nothing to regenerate.");

      await truncateAfter(supabase, sessionId, history[userIndex].id, { inclusive: false });
      history = history.slice(0, userIndex + 1);
    } else if (incoming!.role === "user") {
      const used = await countUserMessagesToday(supabase, user.id, new Date());
      if (used >= AGENT_DAILY_MESSAGE_CAP) {
        return NextResponse.json(
          {
            error: `You've reached today's limit of ${AGENT_DAILY_MESSAGE_CAP} messages. Try again tomorrow.`,
          },
          { status: 429 },
        );
      }

      const message: UIMessage = { id: incoming!.id, role: "user", parts: incoming!.parts };
      const existing = history.findIndex((m) => m.id === message.id);
      if (existing !== -1) {
        // Edit: replace the message and everything after it.
        await truncateAfter(supabase, sessionId, message.id, { inclusive: true });
        history = history.slice(0, existing);
      }
      history = [...history, message];
      toSave = message;
    } else {
      // Continuation after an approval or a client-side tool result.
      const last = history.at(-1);
      if (!last || last.role !== "assistant" || last.id !== incoming!.id) {
        return badRequest("Only the latest reply can be updated.");
      }
      toSave = mergeClientUpdates(last, incoming!);
      history = [...history.slice(0, -1), toSave];
    }

    if (toSave) await upsertMessages(supabase, sessionId, user.id, [toSave]);

    const [profile, memories] = await Promise.all([
      loadPromptProfile(supabase, user.id),
      listMemories(supabase, user.id),
    ]);

    const tools = createAgentTools({ supabase, user, sessionId });
    const contextMessages = selectContextMessages(
      dropAbandonedToolCalls(history),
      session.summary_upto_message_id,
      { window: AGENT_CONTEXT_WINDOW, fullToolTurns: AGENT_FULL_TOOL_OUTPUT_TURNS },
    );

    const result = streamText({
      model: google(AGENT_MODEL),
      system: buildSystemPrompt({
        profile,
        memories,
        now: new Date(),
        summary: session.summary,
      }),
      messages: await convertToModelMessages(contextMessages, { tools }),
      tools,
      stopWhen: stepCountIs(AGENT_MAX_STEPS),
    });

    // Keep consuming if the client disconnects, so onEnd still saves the reply.
    result.consumeStream({ onError: () => {} });

    const reportStreamError = (error: unknown) => {
      void eventCaptureServerException({
        error,
        distinctId: user.id,
        properties: { flow: "agent_chat_stream", session_id: sessionId },
      });
      return STREAM_ERROR_MESSAGE;
    };

    const stream = createUIMessageStream({
      originalMessages: history,
      generateId: createIdGenerator({ prefix: "msg", size: 16 }),
      execute: async ({ writer }) => {
        // Copy the model's chunks in order, so the suggestions and the finish come last.
        for await (const chunk of result.toUIMessageStream({
          sendFinish: false,
          onError: reportStreamError,
        })) {
          writer.write(chunk);
        }

        // Suggest replies only after a final answer, not when the turn is
        // waiting on an approval or upload, hit the step limit, or failed.
        const finishReason = await Promise.resolve(result.finishReason).catch(() => undefined);
        if (finishReason === "stop") {
          const suggestions = await generateFollowUps({
            userText: textOf(history.findLast((m) => m.role === "user")),
            replyText: await result.text,
          });
          if (suggestions.length > 0) {
            writer.write({ type: "data-suggestions", id: "suggestions", data: { suggestions } });
          }
        }

        writer.write({ type: "finish", finishReason });

        // Token usage per turn (all steps), to see what fills the context.
        // Skipped when the model failed, since there's no usage to report.
        if (finishReason && finishReason !== "error") {
          const [usage, steps] = await Promise.all([
            Promise.resolve(result.totalUsage).catch(() => null),
            Promise.resolve(result.steps).catch(() => null),
          ]);
          if (usage) {
            after(() =>
              eventCaptureServer({
                event: PostHogEvent.AgentChatTurn,
                distinctId: user.id,
                properties: {
                  session_id: sessionId,
                  model: AGENT_MODEL,
                  steps: steps?.length ?? null,
                  finish_reason: finishReason,
                  input_tokens: usage.inputTokens ?? null,
                  output_tokens: usage.outputTokens ?? null,
                  cached_input_tokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
                  memory_count: memories.length,
                },
              }),
            );
          }
        }
      },
      onError: reportStreamError,
      onEnd: async ({ messages, responseMessage }) => {
        try {
          await upsertMessages(supabase, sessionId, user.id, [responseMessage]);
          await touchSession(supabase, user.id, sessionId, new Date());
        } catch (error) {
          await eventCaptureServerException({
            error,
            distinctId: user.id,
            properties: { flow: "agent_chat_save", session_id: sessionId },
          });
        }

        // Title and summary use the service-role client: they run after the
        // response, outside the request's cookie scope. Both filter by user_id.
        after(async () => {
          const service = createServiceRoleClient();
          try {
            if (session.title === DEFAULT_TITLE) {
              const title = await generateSessionTitle(messages);
              if (title !== DEFAULT_TITLE) {
                await setSessionTitle(service, user.id, sessionId, title);
              }
            }
            await summariseSession(service, {
              sessionId,
              userId: user.id,
              messages,
              summary: session.summary,
              uptoId: session.summary_upto_message_id,
            });
          } catch (error) {
            await eventCaptureServerException({
              error,
              distinctId: user.id,
              properties: { flow: "agent_chat_after", session_id: sessionId },
            });
          }
        });
      },
    });

    return createUIMessageStreamResponse({
      stream,
      // Read a copy to the end even if the client disconnects, so onEnd runs.
      consumeSseStream: ({ stream: copy }) => consumeStream({ stream: copy, onError: () => {} }),
    });
  } catch (error) {
    return internalError(error, user.id, "agent_chat");
  }
}
