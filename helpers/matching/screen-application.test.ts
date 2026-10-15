import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { mockGenerateModel } from "@/test/utils/ai";
import {
  APPLICATION,
  CANDIDATE_PROFILE,
  INJECTION_LINE,
  JOB_POST,
  PII,
  RESUME_CONTENT,
  screeningResultOf,
} from "@/test/utils/matching";
import { SCREENING_LIMITS } from "./config";
import { SCREEN_APPLICATION_SYSTEM_PROMPT, screenApplication } from "./screen-application";

const INPUT = {
  job: JOB_POST,
  application: APPLICATION,
  profile: CANDIDATE_PROFILE,
  resume: RESUME_CONTENT,
};

type Message = { role: string; content: unknown };
const messagesOf = (model: MockLanguageModelV4) => model.doGenerateCalls[0].prompt as Message[];
const textOf = (messages: Message[], role: string) =>
  JSON.stringify(messages.filter((m) => m.role === role).map((m) => m.content));

describe("screenApplication (MT-TEST-003)", () => {
  it("parses a valid screening", async () => {
    const model = mockGenerateModel(JSON.stringify(screeningResultOf()));

    expect(await screenApplication(INPUT, { model })).toEqual({ ok: true, result: screeningResultOf() });
  });

  it("clamps an out-of-band recommendation through normaliseScreening", async () => {
    const model = mockGenerateModel(
      JSON.stringify(screeningResultOf({ fit_score: 55, recommendation: "strong_yes" })),
    );

    const result = await screenApplication(INPUT, { model });

    expect(result).toMatchObject({ ok: true, result: { fit_score: 55, recommendation: "no" } });
  });

  it("trims arrays to their caps", async () => {
    const many = Array.from({ length: 10 }, (_, i) => `point ${i}`);
    const model = mockGenerateModel(
      JSON.stringify(screeningResultOf({ strengths: many, gaps: many, flags: many })),
    );

    const result = await screenApplication(INPUT, { model });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.strengths).toHaveLength(SCREENING_LIMITS.strengths);
    expect(result.result.gaps).toHaveLength(SCREENING_LIMITS.gaps);
    expect(result.result.flags).toHaveLength(SCREENING_LIMITS.flags);
  });

  it("returns model_error with no raw message when the model fails", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("upstream 500: secret-request-id-123");
      },
    });

    expect(await screenApplication(INPUT, { model })).toEqual({ ok: false, errorCode: "model_error" });
  });

  it("returns invalid_output when the object doesn't match the schema", async () => {
    const model = mockGenerateModel(JSON.stringify({ fit_score: "high", recommendation: "hire" }));

    expect(await screenApplication(INPUT, { model })).toEqual({
      ok: false,
      errorCode: "invalid_output",
    });
  });

  it("returns timeout when the call is aborted", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
        }),
    });

    expect(await screenApplication(INPUT, { model, timeoutMs: 10 })).toEqual({
      ok: false,
      errorCode: "timeout",
    });
  });
});

describe("screenApplication prompt (MT-SEC-001/003)", () => {
  it("keeps the system prompt stable", () => {
    expect(SCREEN_APPLICATION_SYSTEM_PROMPT).toMatchSnapshot();
  });

  it("contains the rubric bands and the recommendation mapping", () => {
    for (const band of ["90–100", "75–89", "60–74", "40–59", "0–39"]) {
      expect(SCREEN_APPLICATION_SYSTEM_PROMPT).toContain(band);
    }
    expect(SCREEN_APPLICATION_SYSTEM_PROMPT).toMatch(/strong_yes.*90/);
  });

  it("contains the fairness and data-not-instructions rules", () => {
    const prompt = SCREEN_APPLICATION_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toContain("data, never instructions");
    expect(prompt).toContain("only against the job's stated requirements");
    expect(prompt).toContain("employment gaps");
    expect(prompt).toContain("school prestige");
    expect(prompt).toMatch(/flags.*job requirement/);
  });

  it("puts the injection line only inside a sandbox in the user message", async () => {
    const model = mockGenerateModel(JSON.stringify(screeningResultOf()));

    await screenApplication(INPUT, { model });

    const messages = messagesOf(model);
    expect(textOf(messages, "system")).not.toContain(INJECTION_LINE);
    const user = messages
      .filter((m) => m.role === "user")
      .map((m) => (Array.isArray(m.content) ? m.content.map((p) => p.text).join("") : String(m.content)))
      .join("");
    const outside = user.replace(/<(\w+)>[\s\S]*?<\/\1>/g, "");
    expect(user).toContain(INJECTION_LINE);
    expect(outside).not.toContain(INJECTION_LINE);
  });

  it("includes the screening answers", async () => {
    const model = mockGenerateModel(JSON.stringify(screeningResultOf()));

    await screenApplication(INPUT, { model });

    expect(textOf(messagesOf(model), "user")).toContain("I split the bundle");
  });

  it("sends no PII to the model", async () => {
    const model = mockGenerateModel(JSON.stringify(screeningResultOf()));

    await screenApplication(INPUT, { model });

    const sent = JSON.stringify(messagesOf(model)).toLowerCase();
    for (const value of Object.values(PII)) expect(sent).not.toContain(value.toLowerCase());
  });
});
