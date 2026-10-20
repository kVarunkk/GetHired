import { after, NextRequest, NextResponse } from "next/server";
import {
  consumeStream,
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isTextUIPart,
  smoothStream,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { internalError, readJson, requireAgentUser } from "@/helpers/agent/auth";
import {
  AGENT_CONTEXT_WINDOW,
  AGENT_FULL_TOOL_OUTPUT_TURNS,
  AGENT_MAX_MESSAGE_CHARS,
  AGENT_MAX_REGENERATIONS,
  AGENT_MAX_STEPS,
  AGENT_MODEL,
  AGENT_SAFETY_SETTINGS,
} from "@/helpers/agent/config";
import { AGENT_ROLES } from "@/helpers/agent/roles";
import { EntitlementError, toEntitlementResponse } from "@/helpers/billing/errors";
import { dropAbandonedToolCalls, selectContextMessages } from "@/helpers/agent/context";
import { mergeClientUpdates } from "@/helpers/agent/client-updates";
import { listMemories } from "@/helpers/agent/memory";
import {
  countUserMessagesToday,
  loadSession,
  setSessionTitle,
  touchSession,
  truncateAfter,
  upsertMessages,
} from "@/helpers/agent/persistence";
import { generateSessionTitle, summariseSession } from "@/helpers/agent/summarise";
import { generateFollowUps } from "@/helpers/agent/suggestions";
import { stoppedReply } from "@/helpers/agent/stopped";
import { canRegenerate, withRegeneration } from "@/helpers/agent/regenerations";
import { agentTelemetry, flushAgentTraces } from "@/helpers/agent/telemetry";
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
const tooManyRequests = (error: string) => NextResponse.json({ error }, { status: 429 });

const dailyCapMessage = (cap: number) =>
  `You've reached today's limit of ${cap} messages. Try again tomorrow.`;

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
  const auth = await requireAgentUser();
  if (!auth.ok) return auth.response;
  const { user, supabase, company } = auth;
  const role = AGENT_ROLES[auth.role];
  if (!role) {
    return NextResponse.json({ error: "The agent isn't available for this account." }, { status: 403 });
  }

  /** Whether the user has sent today's allowance; regenerating then is refused too. */
  const dailyCapReached = async () =>
    (await countUserMessagesToday(supabase, user.id, new Date())) >= role.dailyCap;
  const DAILY_CAP_MESSAGE = dailyCapMessage(role.dailyCap);

  /**
   * Charges a user message to the company's plan before the model runs
   * (BL-TASK-035). Returns the 402 to send when the allowance is used up.
   */
  const chargeMessage = async (messageId: string) => {
    if (!role.chargeMessage || !company) return null;
    try {
      await role.chargeMessage({ company, userId: user.id, messageId });
      return null;
    } catch (error) {
      if (error instanceof EntitlementError) return toEntitlementResponse(error);
      throw error;
    }
  };

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest("Invalid request.");
  const { sessionId, trigger, messageId } = parsed.data;
  const incoming = parsed.data.message as UIMessage | undefined;

  if (incoming?.role === "user") {
    const invalid = validateUserMessage(incoming);
    if (invalid) return badRequest(invalid);
  }

  try {
    const loaded = await loadSession(supabase, user.id, sessionId, { role: role.id });
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

      const parent = history[userIndex];
      if (!canRegenerate(parent)) {
        return tooManyRequests(
          `You can regenerate a reply up to ${AGENT_MAX_REGENERATIONS} times.`,
        );
      }
      if (await dailyCapReached()) return tooManyRequests(DAILY_CAP_MESSAGE);
      // Same ref as the original message, so a regenerate isn't charged again.
      const unpaid = await chargeMessage(parent.id);
      if (unpaid) return unpaid;

      await truncateAfter(supabase, sessionId, parent.id, { inclusive: false });
      toSave = withRegeneration(parent);
      history = [...history.slice(0, userIndex), toSave];
    } else if (incoming!.role === "user") {
      if (await dailyCapReached()) return tooManyRequests(DAILY_CAP_MESSAGE);
      const unpaid = await chargeMessage(incoming!.id);
      if (unpaid) return unpaid;

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

    const [buildPrompt, memories] = await Promise.all([
      role.loadPrompt({ supabase, user, company }),
      listMemories(supabase, user.id),
    ]);

    const tools = role.createTools({ supabase, user, sessionId, company });
    const contextMessages = selectContextMessages(
      dropAbandonedToolCalls(history),
      session.summary_upto_message_id,
      { window: AGENT_CONTEXT_WINDOW, fullToolTurns: AGENT_FULL_TOOL_OUTPUT_TURNS },
    );

    // Agent-only tracing to Arize AX; off when it isn't configured (spec §13).
    const traceContext = company
      ? { sessionId, userId: user.id, companyId: company.id }
      : { sessionId, userId: user.id };
    const traceId = (name: string) => `${role.telemetryPrefix}-${name}`;

    const result = streamText({
      model: google(AGENT_MODEL),
      system: buildPrompt({
        memories,
        now: new Date(),
        summary: session.summary,
        toolNames: Object.keys(tools),
      }),
      messages: await convertToModelMessages(contextMessages, { tools }),
      tools,
      // Which tool calls the user approves, and which are denied (spec §14).
      toolApproval: role.toolApproval,
      providerOptions: { google: { safetySettings: [...AGENT_SAFETY_SETTINGS] } },
      stopWhen: stepCountIs(AGENT_MAX_STEPS),
      // Gemini sends text in large bursts; release it word by word so the
      // reply flows (the client fades each word in).
      experimental_transform: smoothStream({ chunking: "word" }),
      // Stop pressed (or the connection dropped): end the model call and the
      // tool loop too, instead of finishing the turn nobody is reading.
      abortSignal: request.signal,
      telemetry: agentTelemetry(traceId("chat"), traceContext),
    });

    // Read the result to its end (or the abort) even with no client reading.
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
        // waiting on an approval or upload, hit the step limit, failed, or
        // was stopped.
        const finishReason = await Promise.resolve(result.finishReason).catch(() => undefined);
        const stopped = request.signal.aborted;

        // The safety filter blocked the reply: say so instead of ending empty
        // or cut off. It's saved with the message.
        if (finishReason === "content-filter" && !stopped) {
          writer.write({ type: "text-start", id: "content-filter" });
          writer.write({ type: "text-delta", id: "content-filter", delta: role.contentFilterMessage });
          writer.write({ type: "text-end", id: "content-filter" });
        }

        if (finishReason === "stop" && !stopped) {
          const suggestions = await generateFollowUps(
            {
              userText: textOf(history.findLast((m) => m.role === "user")),
              replyText: await result.text,
            },
            {
              telemetry: agentTelemetry(traceId("suggestions"), traceContext),
              // Only set for companies, so the applicant call is unchanged.
              ...(role.id === "company" ? { role: role.id } : {}),
            },
          );
          if (suggestions.length > 0) {
            writer.write({ type: "data-suggestions", id: "suggestions", data: { suggestions } });
          }
        }

        writer.write({ type: "finish", finishReason });

        // Token usage per turn (all steps), to see what fills the context.
        // Skipped when the model failed, since there's no usage to report.
        const loggedReason = stopped ? "aborted" : finishReason;
        if (loggedReason && loggedReason !== "error") {
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
                  finish_reason: loggedReason,
                  input_tokens: usage.inputTokens ?? null,
                  output_tokens: usage.outputTokens ?? null,
                  cached_input_tokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
                  memory_count: memories.length,
                  ...(company ? { role: role.id, company_id: company.id } : {}),
                },
              }),
            );
          }
        }

        // Send this turn's traces while the request is still open: Cloud Run
        // may not give the instance CPU once the response has closed.
        await flushAgentTraces();
      },
      onError: reportStreamError,
      onEnd: async ({ messages: streamed, responseMessage, isAborted }) => {
        // A stopped reply is saved as the user saw it, marked as stopped, or
        // not at all if nothing had arrived yet.
        const stopped = isAborted || request.signal.aborted;
        const reply = stopped ? stoppedReply(responseMessage) : responseMessage;
        const messages = [...streamed.slice(0, -1), ...(reply ? [reply] : [])];

        try {
          if (reply) await upsertMessages(supabase, sessionId, user.id, [reply]);
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
              const title = await generateSessionTitle(messages, {
                telemetry: agentTelemetry(traceId("title"), traceContext),
              });
              if (title !== DEFAULT_TITLE) {
                await setSessionTitle(service, user.id, sessionId, title);
              }
            }
            await summariseSession(
              service,
              {
                sessionId,
                userId: user.id,
                messages,
                summary: session.summary,
                uptoId: session.summary_upto_message_id,
              },
              { telemetry: agentTelemetry(traceId("summary"), traceContext) },
            );
          } catch (error) {
            await eventCaptureServerException({
              error,
              distinctId: user.id,
              properties: { flow: "agent_chat_after", session_id: sessionId },
            });
          }
          await flushAgentTraces();
        });
      },
    });

    return createUIMessageStreamResponse({
      stream,
      // Read a copy to the end even if the client disconnects, so onEnd runs
      // and saves the stopped reply.
      consumeSseStream: ({ stream: copy }) => consumeStream({ stream: copy, onError: () => {} }),
    });
  } catch (error) {
    return internalError(error, user.id, "agent_chat");
  }
}
