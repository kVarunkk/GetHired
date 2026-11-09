import { OpenTelemetry } from "@ai-sdk/otel";
import {
  enrichSpanWithOpenInference,
  isOpenInferenceSpan,
  OpenInferenceSimpleSpanProcessor,
} from "@arizeai/openinference-vercel";
import {
  SEMRESATTRS_PROJECT_NAME,
  SemanticConventions,
} from "@arizeai/openinference-semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { isTextUIPart, type TelemetryOptions, type UIMessage } from "ai";
import { askUserResultForModel } from "./ask-user";
import { CLIENT_TOOL_NAMES } from "./client-updates";
import { AGENT_TRACE_CONTENT } from "./config";
import type { AgentRoleId } from "./roles/types";

export const ARIZE_OTLP_URL = "https://otlp.arize.com/v1/traces";
const DEFAULT_PROJECT_NAME = "gethired-agent";
const TRACER_NAME = "gethired-agent";

/** null: Arize isn't configured. undefined: not set up yet. */
let provider: NodeTracerProvider | null | undefined;

/** Root operations, whose spans carry the whole turn's messages. */
const TURN_OPERATIONS = new Set(["invoke_agent", "ai.streamText", "ai.generateText"]);

/** Whether this span is a root turn span rather than a model, step or tool span. */
function isTurnSpan(attributes: ReadableSpan["attributes"]): boolean {
  const operation = attributes["gen_ai.operation.name"] ?? attributes["ai.operationId"];
  return typeof operation === "string" && TURN_OPERATIONS.has(operation);
}

/**
 * The user-facing text of one message part, or null for a part that isn't
 * shown to the user. Mirrors what `MessageParts` renders: text, never tool
 * payloads, files, approvals or data parts. The AI SDK serializes a text
 * part's body as `content` (older versions used `text`), so both are read.
 */
function visibleText(part: unknown): string | null {
  if (typeof part !== "object" || part === null) return null;
  const { type, text, content } = part as { type?: unknown; text?: unknown; content?: unknown };
  if (type !== "text") return null;
  if (typeof text === "string") return text;
  return typeof content === "string" ? content : null;
}

/** The user-visible text of a serialized message's parts, or null if it has none. */
function visibleTextOf(message: unknown): string | null {
  if (typeof message !== "object" || message === null) return null;
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  const texts = parts.map(visibleText).filter((text): text is string => text !== null);
  return texts.length > 0 ? texts.join("\n") : null;
}

/**
 * Rewrites the root span's `input.value` and `output.value` to the text a
 * user actually saw, keeping `llm.input_messages`/`llm.output_messages` and
 * the model spans' own values intact.
 *
 * The AI SDK emits both as serialized messages that include tool calls,
 * tool responses and finish reasons. Arize evaluators read these two fields,
 * so a relevance judge was scoring tool payloads, and tool results could put
 * a user's contact details into a span (Arize evals read it, the AGENT root
 * is what the chat tasks filter on). The input keeps every user and assistant
 * turn so follow-up questions still have their context.
 *
 * What the user did on a card is part of the conversation too, though it
 * isn't text: an `askUser` answer or an approval. Without it, a judge saw
 * "i want to add some more skills" followed by skills being saved, and
 * scored the agent for inventing them when the user had picked them.
 *
 * A turn that ends on a tool call (an approval, a card, the step cap) has no
 * reply yet. Its output says so instead of carrying the raw tool payloads,
 * and `gethired.turn_end` is `paused`, so the reply evals can skip it.
 */
function withVisibleTurnText(span: ReadableSpan, executedCallIds: ReadonlySet<string> = new Set()): ReadableSpan {
  const attributes = span.attributes;
  if (!isTurnSpan(attributes)) return span;

  const input = parseMessages(attributes["input.value"]);
  if (input) {
    const lines = conversationLines(input, executedCallIds);
    if (lines.length > 0) span.attributes["input.value"] = lines.join("\n\n");
  }

  const rawOutput = attributes["output.value"];
  const output = parseMessages(rawOutput);
  if (output) {
    const { text, turnEnd } = finalReply(output);
    span.attributes[TURN_END_ATTRIBUTE] = turnEnd;
    if (text !== null) span.attributes["output.value"] = text;
  } else if (typeof rawOutput !== "string" || rawOutput.trim() === "") {
    span.attributes[TURN_END_ATTRIBUTE] = "empty";
  } else {
    span.attributes[TURN_END_ATTRIBUTE] = "reply"; // Already plain text.
  }

  return span;
}

/** Root-span attribute: `reply`, `paused` (waiting on the user) or `empty`. */
const TURN_END_ATTRIBUTE = "gethired.turn_end";

/** A serialized message part, as the AI SDK writes it into a span. */
type SerializedPart = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  arguments?: unknown;
  response?: unknown;
};

/** The serialized messages in a span value, or null when it isn't that shape. */
function parseMessages(raw: unknown): unknown[] | null {
  if (typeof raw !== "string") return null;
  try {
    const messages = JSON.parse(raw);
    return Array.isArray(messages) ? messages : null;
  } catch {
    return null; // Not the shape we expect; leave the SDK's value alone.
  }
}

const roleOf = (message: unknown) => (message as { role?: unknown } | null)?.role;

function partsOf(message: unknown): SerializedPart[] {
  const parts = (message as { parts?: unknown } | null)?.parts;
  return Array.isArray(parts) ? (parts.filter((part) => typeof part === "object" && part) as SerializedPart[]) : [];
}

/** The tool calls in a serialized message, with their ids and names. */
function toolCallsOf(message: unknown) {
  return partsOf(message).flatMap((part) =>
    part.type === "tool_call" && typeof part.id === "string" && typeof part.name === "string"
      ? [{ id: part.id, name: part.name, args: part.arguments }]
      : [],
  );
}

const asText = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value ?? null));
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// International (+91 …), US-style ((555) 123-4567) and bare 10-digit numbers.
// Dates, UUIDs and salaries don't match: no "+", and no run of 10 digits.
const PHONE_PATTERN = /\+\d[\d\s().-]{7,16}\d|\(\d{3}\)\s?\d{3}[\s.-]\d{4}|(?<![\w-])\d{10}(?![\w-])/g;

/**
 * Masks emails and phone numbers. Tool results (a profile, a resume) carry
 * the user's contact details, and the trace-level summaries are read by
 * Arize's evaluators, which don't need them.
 */
export function redactContactDetails(text: string): string {
  return text.replace(EMAIL_PATTERN, "[email]").replace(PHONE_PATTERN, "[phone]");
}

/**
 * The conversation as `role: text` lines, with what the user did on a card
 * (a client tool's output, an approval) written as a user line.
 */
function conversationLines(messages: unknown[], executedCallIds: ReadonlySet<string>): string[] {
  const toolNames = new Map<string, string>();
  const answered = new Set<string>();
  for (const message of messages) {
    for (const call of toolCallsOf(message)) toolNames.set(call.id, call.name);
    for (const part of partsOf(message)) {
      if (part.type === "tool_call_response" && typeof part.id === "string") answered.add(part.id);
    }
  }

  const lines: string[] = [];
  let lastCalls: { id: string; name: string }[] = [];
  for (const message of messages) {
    const role = roleOf(message);
    const text = visibleTextOf(message);
    if (text !== null) lines.push(`${typeof role === "string" ? role : "assistant"}: ${text}`);

    if (role === "assistant") {
      const calls = toolCallsOf(message);
      if (calls.length > 0) lastCalls = calls;
      continue;
    }
    if (role !== "tool") continue;

    for (const part of partsOf(message)) {
      const name = typeof part.id === "string" ? toolNames.get(part.id) : undefined;
      if (part.type === "tool_call_response" && name && CLIENT_TOOL_NAMES.has(name)) {
        lines.push(`user (on the ${name} card): ${clip(asText(part.response), 1500)}`);
      }
      if (part.type === "tool-approval-response") {
        // The serialized response doesn't say which way it went; whether the
        // call ran in this trace does. Calls answered earlier aren't pending.
        for (const call of lastCalls.filter((c) => !answered.has(c.id) && !CLIENT_TOOL_NAMES.has(c.name))) {
          lines.push(`user: [${executedCallIds.has(call.id) ? "approved" : "declined"} ${call.name}]`);
        }
        lastCalls = [];
      }
    }
  }
  return lines;
}

/** The reply the user was shown, and how the turn ended. */
function finalReply(messages: unknown[]): { text: string | null; turnEnd: "reply" | "paused" | "empty" } {
  const last = messages.at(-1);
  const replyMessage = messages.findLast((message) => visibleTextOf(message) !== null);
  const reply = replyMessage ? `${asText(roleOf(replyMessage) ?? "assistant")}: ${visibleTextOf(replyMessage)}` : null;
  const pending = toolCallsOf(last);
  const finish = (last as { finish_reason?: unknown } | undefined)?.finish_reason;

  if (finish === "tool_call" || (reply === null && pending.length > 0)) {
    const waiting = pending
      .map((call) => `${call.name}(${clip(redactContactDetails(asText(call.args ?? {})), 300)})`)
      .join(", ");
    const note = `assistant: [no reply yet: the turn is waiting on the user for ${waiting || "a tool call"}]`;
    return { text: reply ? `${reply}\n\n${note}` : note, turnEnd: "paused" };
  }
  if (reply === null) return { text: "assistant: [empty reply]", turnEnd: "empty" };
  return { text: reply, turnEnd: "reply" };
}

/**
 * The tool calls this turn made in earlier requests, read from the root
 * span's input: after an approval or a card the turn continues in a new
 * request (a new trace), and its first steps are only in the messages it
 * was sent. Without them the reply's facts looked unsupported.
 */
function earlierStepCalls(rawInput: unknown): ToolCallRecord[] {
  const messages = parseMessages(rawInput);
  if (!messages) return [];
  const turnStart = messages.findLastIndex((message) => roleOf(message) === "user" && visibleTextOf(message) !== null);
  const turn = messages.slice(turnStart + 1);

  const responses = new Map<string, unknown>();
  for (const message of turn) {
    for (const part of partsOf(message)) {
      if (part.type === "tool_call_response" && typeof part.id === "string") responses.set(part.id, part.response);
    }
  }
  return turn.flatMap((message) =>
    toolCallsOf(message)
      .filter((call) => responses.has(call.id))
      .map((call) => ({ id: call.id, name: call.name, args: asText(call.args ?? {}), result: asText(responses.get(call.id)) })),
  );
}

/** One tool call of a turn, in the order it ran. */
type ToolCallRecord = { id?: string; name: string; args: string; result: string };

/** Root-span attributes holding the turn's tool work, for trace-level evals. */
const TOOL_CALLS_ATTRIBUTE = "gethired.tool_calls";
const TOOL_RESULTS_ATTRIBUTE = "gethired.tool_results";

/**
 * Keeps a trace-level eval inside a reasonable prompt size. At 600, a
 * resume list or profile was cut off before the facts the reply used.
 */
const TOOL_RESULT_MAX_CHARS = 2500;
const TOOL_ARGS_MAX_CHARS = 1000;

/**
 * Renders the turn's tool calls as the ordered list a trajectory eval reads.
 * The order is the point: every span can look right while the sequence is
 * wrong, such as applying to a job before reading it.
 */
function formatToolCalls(calls: ToolCallRecord[]): string {
  return calls
    .map((call, index) => {
      const args = clip(redactContactDetails(call.args), TOOL_ARGS_MAX_CHARS);
      // One line per call: a card's answer has line breaks of its own.
      const result = clip(redactContactDetails(call.result).replace(/\s+/g, " "), 120);
      return `${index + 1}. ${call.name}(${args}) -> ${result}`;
    })
    .join("\n");
}

/**
 * Renders the tool calls and results as the context a groundedness eval
 * checks the reply against, so an invented job or salary can be caught. The
 * arguments are part of it: a write's result often doesn't repeat the values
 * it saved ("updated: desiredRoles"), so they're the evidence for them.
 */
function formatToolResults(calls: ToolCallRecord[]): string {
  return calls
    .map((call, index) => {
      const args = clip(redactContactDetails(call.args), TOOL_ARGS_MAX_CHARS);
      const result = clip(redactContactDetails(call.result), TOOL_RESULT_MAX_CHARS);
      return `[${index + 1}] ${call.name}(${args}): ${result}`;
    })
    .join("\n\n");
}

/**
 * Wraps the OTLP exporter so each span is made judgeable before it leaves the
 * process, after openinference-vercel has written its OpenInference fields.
 */
class VisibleTurnExporter extends OTLPTraceExporter {
  /**
   * The last catalogue each trace advertised. A tool span is exported after
   * the model call that emitted the tool call (a tool cannot run before the
   * model replies), so the catalogue is there when the tool span arrives.
   * Keyed by trace and cleared once the root span exports.
   */
  #catalogues = new Map<string, ToolCatalogue>();

  /** The tool calls each trace made so far, for the trace-level eval inputs. */
  #toolCalls = new Map<string, ToolCallRecord[]>();

  override export(spans: ReadableSpan[], done: (result: ExportResult) => void) {
    const prepared = spans.map((span) => {
      const traceId = span.spanContext().traceId;
      const attributes = span.attributes;
      const kind = attributes["openinference.span.kind"];

      if (kind === "LLM") {
        const catalogue = readToolCatalogue(attributes);
        if (catalogue.size > 0) this.#catalogues.set(traceId, catalogue);
        return withVisibleTurnText(span);
      }

      if (kind === "TOOL") {
        this.#recordToolCall(traceId, attributes);
        return withToolText(span, this.#catalogues.get(traceId));
      }

      // The root span closes the trace: give it the turn's tool work, then
      // forget the trace so a long-lived process doesn't accumulate.
      if (isTurnSpan(attributes)) {
        // Read the earlier steps before the input is rewritten to text.
        const earlier = earlierStepCalls(attributes["input.value"]);
        const executed = this.#toolCalls.get(traceId) ?? [];
        const earlierIds = new Set(earlier.map((call) => call.id));
        const calls = [...earlier, ...executed.filter((call) => !call.id || !earlierIds.has(call.id))];
        const executedIds = new Set(executed.flatMap((call) => (call.id ? [call.id] : [])));
        const prepared = withToolSummary(withVisibleTurnText(span, executedIds), calls);
        this.#catalogues.delete(traceId);
        this.#toolCalls.delete(traceId);
        return prepared;
      }

      return withVisibleTurnText(span);
    });
    super.export(prepared, done);
  }

  #recordToolCall(traceId: string, attributes: ReadableSpan["attributes"]) {
    const name = attributes["gen_ai.tool.name"] ?? attributes[SemanticConventions.TOOL_NAME];
    if (typeof name !== "string") return;
    const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value ?? null));
    const args = attributes["gen_ai.tool.call.arguments"] ?? attributes["input.value"];
    const result = attributes["gen_ai.tool.call.result"] ?? attributes["output.value"];
    const id = attributes["gen_ai.tool.call.id"] ?? attributes[SemanticConventions.TOOL_CALL_ID];
    const calls = this.#toolCalls.get(traceId) ?? [];
    calls.push({
      ...(typeof id === "string" ? { id } : {}),
      name,
      args: text(args ?? {}),
      result: text(result ?? null),
    });
    this.#toolCalls.set(traceId, calls);
  }
}

/**
 * Adds the turn's tool calls and results to the root span, as their own
 * attributes. A trajectory eval reads the ordered calls; a groundedness eval
 * reads the results as the context the reply must be supported by.
 */
function withToolSummary(span: ReadableSpan, calls?: ToolCallRecord[]): ReadableSpan {
  if (!calls || calls.length === 0) return span;
  span.attributes[TOOL_CALLS_ATTRIBUTE] = formatToolCalls(calls);
  span.attributes[TOOL_RESULTS_ATTRIBUTE] = formatToolResults(calls);
  return span;
}

/**
 * One tool as the model was shown it: the OpenInference `tool.name`,
 * `tool.description` and `tool.json_schema` fields (semantic conventions).
 */
type AdvertisedTool = {
  description?: string;
  schema?: unknown;
};

/** A tool catalogue keyed by tool name, as advertised in one model call. */
type ToolCatalogue = Map<string, AdvertisedTool>;

/** `llm.tools` entry, written either as `{tool.json_schema}` or `{function:{…}}`. */
function readAdvertisedTool(entry: unknown): { name: string; tool: AdvertisedTool } | null {
  if (typeof entry !== "object" || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const rawSchema = record[SemanticConventions.TOOL_JSON_SCHEMA] ?? record.schema;
  if (typeof rawSchema !== "string") return null;
  let schema: unknown;
  try {
    schema = JSON.parse(rawSchema);
  } catch {
    return null;
  }
  // `{type:"function", name, description, inputSchema}` (AI SDK) or the
  // OpenAI-style `{type:"function", function:{name, description, parameters}}`.
  const body =
    typeof (schema as { function?: unknown }).function === "object" && (schema as { function?: unknown }).function
      ? (schema as Record<string, unknown>).function as Record<string, unknown>
      : (schema as Record<string, unknown>);
  const name = typeof body.name === "string" ? body.name : undefined;
  if (!name) return null;
  const description = typeof body.description === "string" ? body.description : undefined;
  return { name, tool: { description, schema: body.inputSchema ?? body.parameters } };
}

/**
 * The tools advertised to the model in this call, from the LLM span's
 * `llm.tools` (semantic conventions) or its `gen_ai.tool.definitions`.
 * Empty when the span advertised none.
 */
function readToolCatalogue(attributes: ReadableSpan["attributes"]): ToolCatalogue {
  const catalogue: ToolCatalogue = new Map();

  const listed = attributes[SemanticConventions.LLM_TOOLS];
  const entries = Array.isArray(listed)
    ? listed
    : typeof listed === "string"
      ? (() => {
          try {
            return JSON.parse(listed);
          } catch {
            return [];
          }
        })()
      : [];
  for (const entry of entries) {
    const read = readAdvertisedTool(entry);
    if (read) catalogue.set(read.name, read.tool);
  }

  if (catalogue.size === 0) {
    const defs = attributes["gen_ai.tool.definitions"];
    if (typeof defs === "string") {
      try {
        const parsed = JSON.parse(defs);
        if (Array.isArray(parsed)) {
          for (const definition of parsed) {
            const read = readAdvertisedTool({
              [SemanticConventions.TOOL_JSON_SCHEMA]: JSON.stringify(definition),
            });
            if (read) catalogue.set(read.name, read.tool);
          }
        }
      } catch {
        // Not the shape we expect; leave the tool span without a catalogue.
      }
    }
  }

  return catalogue;
}

/**
 * The top-level argument names of a JSON schema, used to say what the tool
 * accepts when the description alone doesn't make it clear.
 */
function argumentNames(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const properties = (schema as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return [];
  return Object.keys(properties as Record<string, unknown>);
}

/**
 * Gives a tool span the text a judge needs to score the call on its own:
 * which tool was called, what it is documented to do, what it accepts, the
 * arguments used, and the user request that prompted it.
 *
 * OpenInference puts `tool.description` and `tool.json_schema` on the tool
 * span, but the AI SDK never sets them. Without them an evaluator cannot tell
 * whether a better tool existed, and demonstrably misfires: judging
 * `findRelevantJobs` it faulted the absence of `query`/`location` arguments
 * that the tool does not take at all, because it had no schema to check.
 *
 * The catalogue comes from the model call that emitted the call, whose LLM
 * span exports first (a tool only runs after the model replies) and carries
 * the advertised tools. `llm.*` and `gen_ai.tool.call.*` keep their own shape.
 */
function withToolText(span: ReadableSpan, catalogue?: ToolCatalogue): ReadableSpan {
  const attributes = span.attributes;
  if (attributes["openinference.span.kind"] !== "TOOL") return span;

  const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
  const toolName = attributes["gen_ai.tool.name"] ?? attributes[SemanticConventions.TOOL_NAME];
  const args = attributes["gen_ai.tool.call.arguments"] ?? attributes["input.value"];
  const result = attributes["gen_ai.tool.call.result"] ?? attributes["output.value"];
  const request = attributes[USER_TEXT_ATTRIBUTE];
  const advertised = typeof toolName === "string" ? catalogue?.get(toolName) : undefined;

  // The conventions' own fields, so a standards-aware consumer sees them too.
  if (typeof toolName === "string") {
    const advertisedSchema = advertised?.schema;
    if (advertised?.description) {
      span.attributes[SemanticConventions.TOOL_DESCRIPTION] = advertised.description;
    }
    if (advertisedSchema !== undefined) {
      span.attributes[SemanticConventions.TOOL_JSON_SCHEMA] = text(advertisedSchema);
    }

    // `tool.parameters` is the parameters *definition*, but the AI SDK puts the
    // runtime arguments there. Move them to the convention's own field for
    // arguments, and keep the definition where it belongs.
    if (args !== undefined) {
      span.attributes[SemanticConventions.TOOL_CALL_FUNCTION_ARGUMENTS_JSON] = text(args);
    }
    if (advertisedSchema !== undefined) {
      span.attributes[SemanticConventions.TOOL_PARAMETERS] = text(advertisedSchema);
    } else {
      delete span.attributes[SemanticConventions.TOOL_PARAMETERS];
    }
  }

  if (typeof toolName === "string") {
    const parts = [`tool: ${toolName}`];
    if (advertised?.description) parts.push(`purpose: ${advertised.description}`);
    const names = argumentNames(advertised?.schema);
    if (names.length > 0) parts.push(`takes these arguments: ${names.join(", ")}`);
    parts.push(`arguments: ${text(args ?? {})}`);
    if (typeof request === "string") parts.push(`user request: ${request}`);
    span.attributes["input.value"] = parts.join("\n");
    span.attributes["input.mime_type"] = "text/plain";
  }
  if (result !== undefined) {
    span.attributes["output.value"] = text(result);
    span.attributes["output.mime_type"] = "text/plain";
  }
  return span;
}

/**
 * The tracer provider that exports agent spans to Arize AX, created on first
 * use. Neither this provider nor the AI SDK integration is registered
 * globally: only calls that pass `agentTelemetry()` are traced, so the rest
 * of the app and Next.js itself emit nothing (REQ-027). A test enforces this.
 */
function getProvider(): NodeTracerProvider | null {
  if (provider !== undefined) return provider;

  const spaceId = process.env.ARIZE_SPACE_ID;
  const apiKey = process.env.ARIZE_API_KEY;
  if (!spaceId || !apiKey) return (provider = null);

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [SEMRESATTRS_PROJECT_NAME]: process.env.ARIZE_PROJECT_NAME || DEFAULT_PROJECT_NAME,
    }),
    spanProcessors: [
      // Arize's recommendation for short-lived handlers: each span starts
      // exporting as soon as it ends. Only AI spans are kept.
      new OpenInferenceSimpleSpanProcessor({
        exporter: new VisibleTurnExporter({
          url: ARIZE_OTLP_URL,
          headers: { "arize-space-id": spaceId, "arize-api-key": apiKey },
        }),
        spanFilter: isOpenInferenceSpan,
        reparentOrphanedSpans: true,
      }),
    ],
  });
  return provider;
}

export type AgentTraceContext = {
  /** The chat session; null for MCP calls. */
  sessionId: string | null;
  userId: string;
  companyId?: string;
  /** The agent role, so a trace can be told apart by role without a company. */
  role?: AgentRoleId;
  /** This turn's user message, for tool spans that have no prompt of their own. */
  userText?: string;
};

/**
 * The request a turn answers, for `AgentTraceContext.userText`: the latest
 * user message, plus any answers the user gave on a question card since. A
 * turn that continues after an approval or a card has no user message of its
 * own, and its tool spans were judged with no request at all.
 */
export function turnRequestText(history: readonly UIMessage[]): string | undefined {
  const userIndex = history.findLastIndex((message) => message.role === "user");
  if (userIndex === -1) return undefined;

  const lines = [
    history[userIndex].parts
      .filter(isTextUIPart)
      .map((part) => part.text)
      .join("\n"),
  ];
  for (const message of history.slice(userIndex + 1)) {
    for (const part of message.parts) {
      const tool = part as { type: string; state?: string; input?: unknown; output?: unknown };
      if (tool.type === "tool-askUser" && tool.state === "output-available") {
        lines.push(askUserResultForModel(tool.input, tool.output));
      }
    }
  }
  const text = lines.filter((line) => line.trim()).join("\n");
  return text || undefined;
}

/** The span attribute for the recruiter's company (RA spec §4.9). */
const COMPANY_ID_ATTRIBUTE = "gethired.company_id";

/** The agent role (`applicant` | `company`), on every span of the turn. */
const ROLE_ATTRIBUTE = "gethired.role";

/** This turn's user message, for judging a tool call in context. */
const USER_TEXT_ATTRIBUTE = "gethired.user_text";

/**
 * Vercel AI SDK's span attribute. openinference-vercel renames the root span
 * to this when it is present, and uses it to pick the OpenInference span kind.
 */
const OPERATION_NAME = "operation.name";

/**
 * Per-call `telemetry` options for an agent model call (REQ-025). Each call
 * gets its own integration so every span it creates carries the chat's
 * `session.id` and `user.id` (REQ-026). Without Arize credentials, telemetry
 * is off (REQ-028). `recordContent` overrides `AGENT_TRACE_CONTENT`, for
 * calls whose prompts must stay out of traces (screening analysis, SI-SEC-007).
 */
export function agentTelemetry(
  functionId: string,
  { sessionId, userId, companyId, role, userText }: AgentTraceContext,
  { recordContent = AGENT_TRACE_CONTENT }: { recordContent?: boolean } = {},
): TelemetryOptions {
  const tracerProvider = getProvider();
  if (!tracerProvider) return { isEnabled: false };

  return {
    functionId,
    recordInputs: recordContent,
    recordOutputs: recordContent,
    integrations: [
      new OpenTelemetry({
        tracer: tracerProvider.getTracer(TRACER_NAME),
        usage: true,
        enrichSpan: (options) => ({
          ...enrichSpanWithOpenInference(options),
          // Name the root span after the functionId. The AI SDK names it
          // `<operationId> <model>` and sets no `operation.name` on its GenAI
          // spans, so openinference-vercel has nothing to rename it to, and
          // Arize evaluators filter by span name. Root only: model, step and
          // tool spans keep their own names.
          ...(options.spanType === "operation" ? { [OPERATION_NAME]: functionId } : {}),
          ...(sessionId ? { [SemanticConventions.SESSION_ID]: sessionId } : {}),
          [SemanticConventions.USER_ID]: userId,
          ...(companyId ? { [COMPANY_ID_ATTRIBUTE]: companyId } : {}),
          ...(role ? { [ROLE_ATTRIBUTE]: role } : {}),
          // A turn's request is only recorded when content recording is on.
          ...(userText && recordContent ? { [USER_TEXT_ATTRIBUTE]: userText } : {}),
        }),
      }),
    ],
  };
}

/**
 * Tracing for a tool's own model call over MCP (RMCP spec §4.9): the
 * function id is `mcp.<tool>`, and there's no session to group it under.
 * The agent's tool calls aren't traced on their own, so on the agent surface
 * this is undefined and nothing changes there.
 */
export function mcpToolTelemetry(
  ctx: { surface: "agent" | "mcp"; user: { id: string }; company?: { id: string } },
  tool: string,
): TelemetryOptions | undefined {
  if (ctx.surface !== "mcp") return undefined;
  return agentTelemetry(`mcp.${tool}`, { sessionId: null, userId: ctx.user.id, companyId: ctx.company?.id });
}

/**
 * Sends any agent spans still pending. Awaited before the chat response
 * closes, since Cloud Run may not give CPU after it (REQ-029). Never throws:
 * tracing must not break a reply.
 */
export async function flushAgentTraces(): Promise<void> {
  try {
    await provider?.forceFlush();
  } catch {
    // Ignored: losing a trace is better than failing the request.
  }
}

/** Forgets the provider so tests can change the environment. */
export function resetAgentTelemetryForTests() {
  provider = undefined;
}
