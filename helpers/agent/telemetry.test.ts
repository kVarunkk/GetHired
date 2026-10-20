import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { mockGenerateModel } from "@/test/utils/ai";
import {
  agentTelemetry,
  ARIZE_OTLP_URL,
  flushAgentTraces,
  resetAgentTelemetryForTests,
} from "./telemetry";
import { AGENT_TRACE_CONTENT } from "./config";

// An in-memory stand-in for the OTLP exporter: no network, spans kept for assertions.
const exporter = vi.hoisted(() => ({
  configs: [] as { url?: string; headers?: Record<string, string> }[],
  spans: [] as ReadableSpan[],
  flushError: null as Error | null,
}));

vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: class {
    constructor(config: { url?: string; headers?: Record<string, string> }) {
      exporter.configs.push(config);
    }
    export(spans: ReadableSpan[], done: (result: { code: number }) => void) {
      exporter.spans.push(...spans);
      done({ code: 0 });
    }
    async forceFlush() {
      if (exporter.flushError) throw exporter.flushError;
    }
    async shutdown() {}
  },
}));

const CONTEXT = { sessionId: "55555555-5555-4555-8555-555555555555", userId: "u1" };

beforeEach(() => {
  resetAgentTelemetryForTests();
  exporter.configs.length = 0;
  exporter.spans.length = 0;
  exporter.flushError = null;
});

afterEach(() => vi.unstubAllEnvs());

const configure = () => {
  vi.stubEnv("ARIZE_SPACE_ID", "space-1");
  vi.stubEnv("ARIZE_API_KEY", "key-1");
};

describe("agentTelemetry without Arize credentials (REQ-028)", () => {
  it("turns telemetry off and creates no exporter", () => {
    vi.stubEnv("ARIZE_SPACE_ID", "");
    vi.stubEnv("ARIZE_API_KEY", "");

    expect(agentTelemetry("agent-chat", CONTEXT)).toEqual({ isEnabled: false });
    expect(exporter.configs).toHaveLength(0);
  });

  it("flushing is a no-op", async () => {
    await expect(flushAgentTraces()).resolves.toBeUndefined();
  });
});

describe("agentTelemetry with Arize credentials", () => {
  it("returns per-call options with the function id and one integration", () => {
    configure();

    const options = agentTelemetry("agent-chat", CONTEXT);

    expect(options).toMatchObject({
      functionId: "agent-chat",
      recordInputs: AGENT_TRACE_CONTENT,
      recordOutputs: AGENT_TRACE_CONTENT,
    });
    expect(options.integrations).toHaveLength(1);
  });

  it("lets a call turn content recording off", () => {
    configure();

    const options = agentTelemetry("screening-interview-analysis", CONTEXT, { recordContent: false });

    expect(options).toMatchObject({ recordInputs: false, recordOutputs: false });
  });

  it("exports to Arize AX with the space id and API key headers", () => {
    configure();

    agentTelemetry("agent-chat", CONTEXT);

    expect(exporter.configs).toEqual([
      { url: ARIZE_OTLP_URL, headers: { "arize-space-id": "space-1", "arize-api-key": "key-1" } },
    ]);
    expect(ARIZE_OTLP_URL).toBe("https://otlp.arize.com/v1/traces");
  });

  it("creates the exporter once, however many calls are traced", () => {
    configure();

    agentTelemetry("agent-chat", CONTEXT);
    agentTelemetry("agent-title", CONTEXT);

    expect(exporter.configs).toHaveLength(1);
  });

  it("traces an agent model call with its session, user and project (REQ-025, REQ-026)", async () => {
    configure();

    await generateText({
      model: mockGenerateModel("A short title"),
      prompt: "Title this chat",
      telemetry: agentTelemetry("agent-title", CONTEXT),
    });
    await flushAgentTraces();

    // Only AI spans pass Arize's filter, and every one carries the ids.
    expect(exporter.spans.length).toBeGreaterThan(0);
    for (const span of exporter.spans) {
      expect(span.attributes["session.id"]).toBe(CONTEXT.sessionId);
      expect(span.attributes["user.id"]).toBe(CONTEXT.userId);
      expect(span.attributes["openinference.span.kind"]).toBeDefined();
      expect(span.resource.attributes["openinference.project.name"]).toBe("gethired-agent");
    }
  });

  it("uses ARIZE_PROJECT_NAME when set", async () => {
    configure();
    vi.stubEnv("ARIZE_PROJECT_NAME", "gethired-agent-staging");

    await generateText({
      model: mockGenerateModel("ok"),
      prompt: "x",
      telemetry: agentTelemetry("agent-title", CONTEXT),
    });
    await flushAgentTraces();

    expect(exporter.spans[0].resource.attributes["openinference.project.name"]).toBe(
      "gethired-agent-staging",
    );
  });

  it("leaves untraced a call that doesn't pass the agent's options (REQ-027)", async () => {
    configure();
    agentTelemetry("agent-chat", CONTEXT); // provider exists

    await generateText({ model: mockGenerateModel("ok"), prompt: "not the agent" });
    await flushAgentTraces();

    expect(exporter.spans).toHaveLength(0);
  });

  it("never lets a failed flush break the request", async () => {
    configure();
    agentTelemetry("agent-chat", CONTEXT);
    exporter.flushError = new Error("arize down");

    await expect(flushAgentTraces()).resolves.toBeUndefined();
  });
});

describe("tracing stays agent-only (REQ-027)", () => {
  // Global registration would trace every AI SDK call in the app (and let
  // Next.js emit its own spans). Only helpers/agent/telemetry.ts may set up
  // tracing, and it must stay per-call.
  it("nothing registers telemetry or a tracer provider globally", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const source = readFileSync(path, "utf8");
          if (/registerTelemetry\(|registerOTel\(|\bprovider\.register\(/.test(source)) {
            offenders.push(path);
          }
        }
      }
    };
    for (const dir of ["app", "components", "helpers", "lib", "utils"]) walk(dir);
    for (const file of ["instrumentation.ts", "instrumentation-client.ts", "middleware.ts"]) {
      if (existsSync(file) && /registerTelemetry\(|registerOTel\(/.test(readFileSync(file, "utf8"))) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
