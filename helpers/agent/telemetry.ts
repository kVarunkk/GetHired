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
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { TelemetryOptions } from "ai";
import { AGENT_TRACE_CONTENT } from "./config";

export const ARIZE_OTLP_URL = "https://otlp.arize.com/v1/traces";
const DEFAULT_PROJECT_NAME = "gethired-agent";
const TRACER_NAME = "gethired-agent";

/** null: Arize isn't configured. undefined: not set up yet. */
let provider: NodeTracerProvider | null | undefined;

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
        exporter: new OTLPTraceExporter({
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

export type AgentTraceContext = { sessionId: string; userId: string; companyId?: string };

/** The span attribute for the recruiter's company (RA spec §4.9). */
const COMPANY_ID_ATTRIBUTE = "gethired.company_id";

/**
 * Per-call `telemetry` options for an agent model call (REQ-025). Each call
 * gets its own integration so every span it creates carries the chat's
 * `session.id` and `user.id` (REQ-026). Without Arize credentials, telemetry
 * is off (REQ-028). `recordContent` overrides `AGENT_TRACE_CONTENT`, for
 * calls whose prompts must stay out of traces (screening analysis, SI-SEC-007).
 */
export function agentTelemetry(
  functionId: string,
  { sessionId, userId, companyId }: AgentTraceContext,
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
          [SemanticConventions.SESSION_ID]: sessionId,
          [SemanticConventions.USER_ID]: userId,
          ...(companyId ? { [COMPANY_ID_ATTRIBUTE]: companyId } : {}),
        }),
      }),
    ],
  };
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
