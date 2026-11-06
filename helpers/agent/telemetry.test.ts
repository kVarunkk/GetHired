import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText, streamText, tool, stepCountIs } from "ai";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { mockGenerateModel, mockModel, textStream, toolCallStream } from "@/test/utils/ai";
import { z } from "zod";
import {
  agentTelemetry,
  ARIZE_OTLP_URL,
  flushAgentTraces,
  mcpToolTelemetry,
  resetAgentTelemetryForTests,
} from "./telemetry";
import { AGENT_TRACE_CONTENT } from "./config";

// An in-memory stand-in for the OTLP exporter: no network, spans kept for assertions.
// It extends the real class so the app's VisibleTurnExporter subclass still runs
// and its transform shows up in `spans`.
const exporter = vi.hoisted(() => ({
  configs: [] as { url?: string; headers?: Record<string, string> }[],
  spans: [] as ReadableSpan[],
  flushError: null as Error | null,
}));

vi.mock("@opentelemetry/exporter-trace-otlp-proto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@opentelemetry/exporter-trace-otlp-proto")>();
  return {
    OTLPTraceExporter: class extends actual.OTLPTraceExporter {
      constructor(config: { url?: string; headers?: Record<string, string> }) {
        super(config);
        exporter.configs.push(config);
      }
      override export(spans: ReadableSpan[], done: (result: { code: number }) => void) {
        exporter.spans.push(...spans);
        done({ code: 0 });
      }
      override async forceFlush() {
        if (exporter.flushError) throw exporter.flushError;
      }
      async shutdown() {}
    },
  };
});

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

  it("names the root span after the functionId so name filters match", async () => {
    configure();

    await generateText({
      model: mockGenerateModel("A short title"),
      prompt: "Title this chat",
      telemetry: agentTelemetry("agent-chat", CONTEXT),
    });
    await flushAgentTraces();

    // The AI SDK names spans `<operationId> <model>`, and its GenAI spans carry
    // no `operation.name`, so openinference-vercel can't rename them. Without
    // this the root is `invoke_agent <model>` and `name = 'agent-chat'` matches
    // nothing. `functionId` leaves the span name in Arize's UI; the app's
    // evaluators filter on `agent.name`, which this test also pins.
    const root = exporter.spans.find((span) => span.name === "agent-chat");
    expect(root).toBeDefined();
    expect(root?.attributes["gen_ai.agent.name"]).toBe("agent-chat");
  });

  it("names each functionId's root span, so both roles are distinguishable", async () => {
    configure();

    await generateText({
      model: mockGenerateModel("ok"),
      prompt: "a",
      telemetry: agentTelemetry("agent-chat", CONTEXT),
    });
    await generateText({
      model: mockGenerateModel("ok"),
      prompt: "b",
      telemetry: agentTelemetry("recruiter-agent-chat", { ...CONTEXT, companyId: "co-1" }),
    });
    await flushAgentTraces();

    const names = exporter.spans.map((span) => span.name);
    expect(names).toContain("agent-chat");
    expect(names).toContain("recruiter-agent-chat");
    // The company attribute is how a recruiter trace is told apart at all.
    const recruiterRoot = exporter.spans.find((span) => span.name === "recruiter-agent-chat");
    expect(recruiterRoot?.attributes["gethired.company_id"]).toBe("co-1");
  });

  it("leaves child spans' own names alone", async () => {
    configure();

    // A tool call makes streamText emit model, step and tool spans too.
    const result = streamText({
      model: mockModel([toolCallStream("findRelevantJobs", {}), textStream("done")]),
      system: "sys",
      messages: [{ role: "user", content: "find jobs" }],
      tools: {
        findRelevantJobs: tool({
          inputSchema: z.object({}),
          execute: async () => ({ jobs: [] }),
        }),
      },
      stopWhen: stepCountIs(4),
      telemetry: agentTelemetry("agent-chat", CONTEXT),
    });
    await result.consumeStream();
    await flushAgentTraces();

    const names = exporter.spans.map((span) => span.name);
    // Renaming is root-only: the tool span keeps its AI SDK name.
    expect(names).toContain("execute_tool findRelevantJobs");
    expect(names.some((name) => name.startsWith("step "))).toBe(true);
    // Only the root got the functionId.
    expect(names.filter((name) => name === "agent-chat")).toHaveLength(1);
  });

  it("makes a tool span judgeable on its own", async () => {
    configure();

    const result = streamText({
      model: mockModel([
        toolCallStream("findRelevantJobs", { limit: 10 }),
        textStream("Here are your jobs."),
      ]),
      messages: [{ role: "user", content: "find me remote react jobs in pune" }],
      tools: {
        findRelevantJobs: tool({
          description: "Rank open jobs against the user's stored profile.",
          inputSchema: z.object({ limit: z.number() }),
          execute: async () => ({ jobs: [{ title: "React dev", location: "Pune" }] }),
        }),
        searchJobs: tool({
          description: "Keyword search over job titles.",
          inputSchema: z.object({ query: z.string() }),
          execute: async () => ({ jobs: [] }),
        }),
      },
      stopWhen: stepCountIs(4),
      telemetry: agentTelemetry("agent-chat", {
        ...CONTEXT,
        role: "applicant",
        userText: "find me remote react jobs in pune",
      }),
    });
    await result.consumeStream();
    await flushAgentTraces();

    const toolSpan = exporter.spans.find((span) => span.name.startsWith("execute_tool"));
    // The AI SDK emits only the arguments, so a judge had no idea what the
    // user asked for, what the tool does, or what it accepts.
    expect(toolSpan?.attributes["input.value"]).toBe(
      [
        "tool: findRelevantJobs",
        "purpose: Rank open jobs against the user's stored profile.",
        "takes these arguments: limit",
        'arguments: {"limit":10}',
        "user request: find me remote react jobs in pune",
      ].join("\n"),
    );
    expect(toolSpan?.attributes["output.value"]).toBe(
      '{"jobs":[{"title":"React dev","location":"Pune"}]}',
    );
    // Both are text now, so an evaluator reads them as prose, not JSON.
    expect(toolSpan?.attributes["input.mime_type"]).toBe("text/plain");
    expect(toolSpan?.attributes["output.mime_type"]).toBe("text/plain");
    // The structured fields a tool eval may also want are untouched.
    expect(toolSpan?.attributes["tool.name"]).toBe("findRelevantJobs");
    expect(String(toolSpan?.attributes["gen_ai.tool.call.arguments"])).toContain("limit");
  });

  it("documents a tool span the way the OpenInference conventions ask", async () => {
    configure();

    const result = streamText({
      model: mockModel([toolCallStream("findRelevantJobs", { limit: 3 }), textStream("Done.")]),
      messages: [{ role: "user", content: "jobs for me" }],
      tools: {
        findRelevantJobs: tool({
          description: "Rank open jobs against the user's stored profile.",
          inputSchema: z.object({ limit: z.number() }),
          execute: async () => ({ jobs: [] }),
        }),
      },
      stopWhen: stepCountIs(4),
      telemetry: agentTelemetry("agent-chat", { ...CONTEXT, role: "applicant", userText: "jobs for me" }),
    });
    await result.consumeStream();
    await flushAgentTraces();

    const toolSpan = exporter.spans.find((span) => span.name.startsWith("execute_tool"));
    // The spec puts these on a TOOL span; the AI SDK sets neither, which is
    // why the evaluator faulted arguments the tool does not even take.
    expect(toolSpan?.attributes["tool.description"]).toBe(
      "Rank open jobs against the user's stored profile.",
    );
    const schema = JSON.parse(String(toolSpan?.attributes["tool.json_schema"]));
    expect(Object.keys(schema.properties)).toEqual(["limit"]);
  });

  it("copes with a tool that has no description", async () => {
    configure();

    const result = streamText({
      model: mockModel([toolCallStream("saveJob", { job_id: "j-1" }), textStream("Saved.")]),
      messages: [{ role: "user", content: "save that one" }],
      tools: {
        // A tool without a description still has to read sensibly, and must
        // not invent a purpose for the judge.
        saveJob: tool({
          inputSchema: z.object({ job_id: z.string() }),
          execute: async () => ({ saved: true }),
        }),
      },
      stopWhen: stepCountIs(4),
      telemetry: agentTelemetry("agent-chat", { ...CONTEXT, role: "applicant", userText: "save that one" }),
    });
    await result.consumeStream();
    await flushAgentTraces();

    const toolSpan = exporter.spans.find((span) => span.name.startsWith("execute_tool"));
    expect(toolSpan?.attributes["input.value"]).toBe(
      [
        "tool: saveJob",
        "takes these arguments: job_id",
        'arguments: {"job_id":"j-1"}',
        "user request: save that one",
      ].join("\n"),
    );
    expect(toolSpan?.attributes["tool.description"]).toBeUndefined();
    // The schema is still there, so arguments remain checkable.
    expect(String(toolSpan?.attributes["tool.json_schema"])).toContain("job_id");
  });

  it("puts the tool's definition in tool.parameters, not its arguments", async () => {
    configure();

    const result = streamText({
      model: mockModel([toolCallStream("findRelevantJobs", { limit: 4 }), textStream("Done.")]),
      messages: [{ role: "user", content: "jobs for me" }],
      tools: {
        findRelevantJobs: tool({
          description: "Rank open jobs against the user's stored profile.",
          inputSchema: z.object({ limit: z.number() }),
          execute: async () => ({ jobs: [] }),
        }),
      },
      stopWhen: stepCountIs(4),
      telemetry: agentTelemetry("agent-chat", { ...CONTEXT, role: "applicant", userText: "jobs for me" }),
    });
    await result.consumeStream();
    await flushAgentTraces();

    const toolSpan = exporter.spans.find((span) => span.name.startsWith("execute_tool"));
    // The AI SDK writes the runtime arguments into tool.parameters, but the
    // conventions reserve that for the definition. A spec-aware consumer
    // reading {"limit":4} as a schema would conclude the tool takes a
    // literal, not a number.
    const definition = JSON.parse(String(toolSpan?.attributes["tool.parameters"]));
    expect(Object.keys(definition.properties)).toEqual(["limit"]);
    // The arguments live in the convention's own field.
    expect(toolSpan?.attributes["tool_call.function.arguments"]).toBe('{"limit":4}');
  });

  it("gives the root span the turn's tool calls and results in order", async () => {
    configure();

    const result = streamText({
      model: mockModel([
        toolCallStream("getJobDetails", { job_id: "j-1" }),
        toolCallStream("applyToJob", { job_id: "j-1" }),
        textStream("Applied."),
      ]),
      messages: [{ role: "user", content: "apply to that rust job" }],
      tools: {
        getJobDetails: tool({
          description: "Read one job posting.",
          inputSchema: z.object({ job_id: z.string() }),
          execute: async () => ({ title: "Rust Engineer", location: "Berlin" }),
        }),
        applyToJob: tool({
          description: "Submit an application.",
          inputSchema: z.object({ job_id: z.string() }),
          execute: async () => ({ status: "submitted" }),
        }),
      },
      stopWhen: stepCountIs(4),
      telemetry: agentTelemetry("agent-chat", { ...CONTEXT, role: "applicant", userText: "apply to that rust job" }),
    });
    await result.consumeStream();
    await flushAgentTraces();

    const root = exporter.spans.find((span) => span.name === "agent-chat");
    // A trajectory eval needs the order: applying before reading is a bug
    // even when each call in isolation looks fine.
    const calls = String(root?.attributes["gethired.tool_calls"]).split("\n");
    expect(calls[0]).toContain("getJobDetails");
    expect(calls[1]).toContain("applyToJob");
    expect(calls[0]).toContain('{"job_id":"j-1"}');
    // A groundedness eval needs the results as the context to check against.
    const results = String(root?.attributes["gethired.tool_results"]);
    expect(results).toContain("Rust Engineer");
    expect(results).toContain("submitted");
  });

  it("leaves the root span alone when the turn called no tools", async () => {
    configure();

    const result = streamText({
      model: mockModel([textStream("Hello there.")]),
      messages: [{ role: "user", content: "hi" }],
      telemetry: agentTelemetry("agent-chat", { ...CONTEXT, role: "applicant", userText: "hi" }),
    });
    await result.consumeStream();
    await flushAgentTraces();

    const root = exporter.spans.find((span) => span.name === "agent-chat");
    expect(root?.attributes["gethired.tool_calls"]).toBeUndefined();
    expect(root?.attributes["gethired.tool_results"]).toBeUndefined();
  });

  it("puts the role and this turn's request on every span", async () => {
    configure();

    const result = streamText({
      model: mockModel([textStream("An answer.")]),
      messages: [{ role: "user", content: "find me jobs" }],
      telemetry: agentTelemetry("recruiter-agent-chat", {
        ...CONTEXT,
        companyId: "co-1",
        role: "company",
        userText: "find me backend engineers",
      }),
    });
    await result.consumeStream();
    await flushAgentTraces();

    // Without a company, nothing told an applicant trace from a recruiter one.
    for (const span of exporter.spans) {
      expect(span.attributes["gethired.role"]).toBe("company");
      expect(span.attributes["gethired.user_text"]).toBe("find me backend engineers");
    }
  });

  it("keeps the request out of traces when content recording is off", async () => {
    configure();

    const result = streamText({
      model: mockModel([textStream("An answer.")]),
      messages: [{ role: "user", content: "my private request" }],
      telemetry: agentTelemetry(
        "screening-interview-analysis",
        { ...CONTEXT, role: "company", userText: "my private request" },
        { recordContent: false },
      ),
    });
    await result.consumeStream();
    await flushAgentTraces();

    // SI-SEC-007: a call whose prompts must stay out of traces keeps them out.
    expect(exporter.spans.length).toBeGreaterThan(0);
    for (const span of exporter.spans) {
      expect(span.attributes["gethired.user_text"]).toBeUndefined();
      // The role is not content, so it stays for filtering.
      expect(span.attributes["gethired.role"]).toBe("company");
    }
  });

  it("gives evaluators the visible text, not tool payloads", async () => {
    configure();

    const result = streamText({
      model: mockModel([toolCallStream("getMyProfile", {}), textStream("Here are your matches.")]),
      system: "system prompt",
      messages: [{ role: "user", content: "find me jobs" }],
      tools: {
        getMyProfile: tool({
          inputSchema: z.object({}),
          execute: async () => ({ email: "someone@private.example", phone: "+10000000000" }),
        }),
      },
      stopWhen: stepCountIs(4),
      telemetry: agentTelemetry("agent-chat", CONTEXT),
    });
    await result.consumeStream();
    await flushAgentTraces();

    // Arize's chat tasks map these two fields into the evaluator prompt.
    const root = exporter.spans.find((span) => span.name === "agent-chat");
    expect(root?.attributes["input.value"]).toBe("user: find me jobs");
    expect(root?.attributes["output.value"]).toBe("assistant: Here are your matches.");

    // Tool results must not reach the evaluated text: they can hold a user's
    // contact details, and a relevance judge would be scoring a tool dump.
    const evaluated = `${root?.attributes["input.value"]} ${root?.attributes["output.value"]}`;
    expect(evaluated).not.toContain("private.example");
    expect(evaluated).not.toContain("tool_call");
  });

  it("keeps prior turns in the input but only the final reply in the output", async () => {
    configure();

    const result = streamText({
      model: mockModel([textStream("Second answer.")]),
      messages: [
        { role: "user", content: "find me jobs" },
        { role: "assistant", content: "Here are some jobs." },
        { role: "user", content: "only remote ones" },
      ],
      telemetry: agentTelemetry("agent-chat", CONTEXT),
    });
    await result.consumeStream();
    await flushAgentTraces();

    const root = exporter.spans.find((span) => span.name === "agent-chat");
    // A follow-up ("only remote ones") needs its context to be judgeable.
    expect(root?.attributes["input.value"]).toContain("find me jobs");
    expect(root?.attributes["input.value"]).toContain("only remote ones");
    expect(root?.attributes["output.value"]).toBe("assistant: Second answer.");
  });

  it("leaves the model spans' own values in their structured form", async () => {
    configure();

    const result = streamText({
      model: mockModel([textStream("An answer.")]),
      messages: [{ role: "user", content: "hi" }],
      telemetry: agentTelemetry("agent-chat", CONTEXT),
    });
    await result.consumeStream();
    await flushAgentTraces();

    // Only the root is rewritten, so token/groundedness work keeps the
    // per-call messages it already relies on.
    const modelSpan = exporter.spans.find((span) => span.name.startsWith("chat "));
    expect(modelSpan?.attributes["llm.input_messages.0.message.role"]).toBe("user");
    // The model span's raw value keeps the SDK's serialized shape.
    expect(String(modelSpan?.attributes["output.value"])).toContain("parts");
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
    // A synchronous walk of the whole source tree: slow on Windows under a full run.
  }, 30_000);
});

describe("mcpToolTelemetry (RMCP spec §4.9)", () => {
  const user = { id: "u1" };
  const company = { id: "c1" };

  it("traces a tool's model call over MCP as mcp.<tool>", () => {
    configure();

    expect(mcpToolTelemetry({ surface: "mcp", user, company }, "explain_match")).toMatchObject({
      functionId: "mcp.explain_match",
    });
  });

  it("records the user and company, and no session", async () => {
    configure();

    await generateText({
      model: mockGenerateModel("ok"),
      prompt: "x",
      telemetry: mcpToolTelemetry({ surface: "mcp", user, company }, "explain_match"),
    });
    await flushAgentTraces();

    expect(exporter.spans.length).toBeGreaterThan(0);
    for (const span of exporter.spans) {
      expect(span.attributes["session.id"]).toBeUndefined();
      expect(span.attributes["user.id"]).toBe("u1");
      expect(span.attributes["gethired.company_id"]).toBe("c1");
    }
  });

  it("is off without Arize credentials", () => {
    vi.stubEnv("ARIZE_SPACE_ID", "");
    vi.stubEnv("ARIZE_API_KEY", "");

    expect(mcpToolTelemetry({ surface: "mcp", user, company }, "explain_match")).toEqual({ isEnabled: false });
  });

  it("leaves the agent's tool calls untraced", () => {
    configure();

    expect(mcpToolTelemetry({ surface: "agent", user, company }, "explain_match")).toBeUndefined();
    expect(exporter.configs).toHaveLength(0);
  });
});
