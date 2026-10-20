import { describe, expect, it } from "vitest";
import {
  END_REASONS,
  SCREENING_CONSENT_VERSION,
  configSnapshotSchema,
  interviewConfigSchema,
  screeningConsentText,
  screeningReportSchema,
  storedScreeningReportSchema,
  transcriptCallbackSchema,
} from "./schemas";
import callbackFixture from "./fixtures/transcript-callback.json";

const competency = (name = "System design", description = "Reasons about trade-offs at scale.") => ({
  name,
  description,
});

const config = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  invite_rule: "fit_threshold",
  fit_threshold: 70,
  questions: [{ text: "Walk me through a service you designed." }],
  competencies: [competency()],
  duration_minutes: 15,
  deadline_days: 5,
  language: "en",
  ...overrides,
});

/** The first issue's message, or null when the input parses. */
const errorOf = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? null : result.error!.issues[0].message;
};

const repeat = (n: number) => "x".repeat(n);

describe("interviewConfigSchema", () => {
  it("accepts a full config", () => {
    expect(interviewConfigSchema.parse(config())).toEqual(config());
  });

  it("fills the defaults: fit_threshold at 70, 15 minutes, 5 days, English", () => {
    expect(interviewConfigSchema.parse({ enabled: false })).toEqual({
      enabled: false,
      invite_rule: "fit_threshold",
      fit_threshold: 70,
      questions: [],
      competencies: [],
      duration_minutes: 15,
      deadline_days: 5,
      language: "en",
    });
  });

  it("allows 0–8 questions of up to 300 characters", () => {
    expect(errorOf(interviewConfigSchema, config({ questions: [] }))).toBeNull();
    const eight = Array.from({ length: 8 }, () => ({ text: repeat(300) }));
    expect(errorOf(interviewConfigSchema, config({ questions: eight }))).toBeNull();
    expect(errorOf(interviewConfigSchema, config({ questions: [...eight, { text: "One more?" }] }))).toBe(
      "Add at most 8 questions.",
    );
    expect(errorOf(interviewConfigSchema, config({ questions: [{ text: repeat(301) }] }))).toBe(
      "Keep each question under 300 characters.",
    );
    expect(errorOf(interviewConfigSchema, config({ questions: [{ text: "   " }] }))).toBe(
      "A question can't be empty.",
    );
  });

  it("allows 1–5 competencies when enabled, with name ≤ 60 and description ≤ 300", () => {
    const five = Array.from({ length: 5 }, (_, i) => competency(`Skill ${i}`));
    expect(errorOf(interviewConfigSchema, config({ competencies: five }))).toBeNull();
    expect(errorOf(interviewConfigSchema, config({ competencies: [...five, competency("Sixth")] }))).toBe(
      "Add at most 5 competencies.",
    );
    expect(errorOf(interviewConfigSchema, config({ competencies: [competency(repeat(61))] }))).toBe(
      "Keep each competency name under 60 characters.",
    );
    expect(errorOf(interviewConfigSchema, config({ competencies: [competency("Design", repeat(301))] }))).toBe(
      "Keep each competency description under 300 characters.",
    );
    expect(errorOf(interviewConfigSchema, config({ competencies: [competency("  ")] }))).toBe(
      "A competency needs a name.",
    );
  });

  it("rejects an enabled interview with no competencies, but allows a disabled one", () => {
    expect(errorOf(interviewConfigSchema, config({ competencies: [] }))).toBe(
      "Add at least one competency to turn the interview on.",
    );
    expect(errorOf(interviewConfigSchema, config({ enabled: false, competencies: [] }))).toBeNull();
  });

  it("only allows 10, 15 or 20 minutes", () => {
    for (const minutes of [10, 15, 20]) {
      expect(errorOf(interviewConfigSchema, config({ duration_minutes: minutes }))).toBeNull();
    }
    expect(errorOf(interviewConfigSchema, config({ duration_minutes: 12 }))).toBe(
      "Choose 10, 15 or 20 minutes.",
    );
  });

  it("allows a deadline of 3–14 whole days", () => {
    expect(errorOf(interviewConfigSchema, config({ deadline_days: 3 }))).toBeNull();
    expect(errorOf(interviewConfigSchema, config({ deadline_days: 14 }))).toBeNull();
    expect(errorOf(interviewConfigSchema, config({ deadline_days: 2 }))).toBe(
      "The deadline must be 3–14 days.",
    );
    expect(errorOf(interviewConfigSchema, config({ deadline_days: 15 }))).toBe(
      "The deadline must be 3–14 days.",
    );
    expect(errorOf(interviewConfigSchema, config({ deadline_days: 4.5 }))).toBe(
      "The deadline must be 3–14 days.",
    );
  });

  it("only knows the fit_threshold and manual invite rules", () => {
    expect(errorOf(interviewConfigSchema, config({ invite_rule: "manual", fit_threshold: null }))).toBeNull();
    expect(errorOf(interviewConfigSchema, config({ invite_rule: "all" }))).toBe(
      "Choose who gets invited.",
    );
  });

  it("needs a 0–100 threshold for fit_threshold", () => {
    expect(errorOf(interviewConfigSchema, config({ fit_threshold: null }))).toBe(
      "Set the minimum fit score (0–100).",
    );
    expect(errorOf(interviewConfigSchema, config({ fit_threshold: 101 }))).toBe(
      "Set the minimum fit score (0–100).",
    );
    expect(errorOf(interviewConfigSchema, config({ fit_threshold: -1 }))).toBe(
      "Set the minimum fit score (0–100).",
    );
    expect(errorOf(interviewConfigSchema, config({ fit_threshold: 0 }))).toBeNull();
  });

  it("only speaks English at launch", () => {
    expect(errorOf(interviewConfigSchema, config({ language: "de" }))).not.toBeNull();
  });

  it("rejects unknown keys, at every level", () => {
    expect(errorOf(interviewConfigSchema, config({ company_id: "c1" }))).not.toBeNull();
    expect(errorOf(interviewConfigSchema, config({ questions: [{ text: "Hi", weight: 2 }] }))).not.toBeNull();
    expect(
      errorOf(interviewConfigSchema, config({ competencies: [{ ...competency(), weight: 2 }] })),
    ).not.toBeNull();
  });

  it("trims text", () => {
    const parsed = interviewConfigSchema.parse(
      config({ questions: [{ text: "  Why us?  " }], competencies: [competency("  Design ", " Trade-offs ")] }),
    );
    expect(parsed.questions).toEqual([{ text: "Why us?" }]);
    expect(parsed.competencies).toEqual([{ name: "Design", description: "Trade-offs" }]);
  });
});

describe("configSnapshotSchema", () => {
  const snapshot = {
    questions: [{ text: "Why us?" }],
    competencies: [competency()],
    duration_minutes: 15,
    deadline_days: 5,
    language: "en",
    company_name: "Acme",
    job_title: "Backend Engineer",
  };

  // The keys create_screening_invite writes (20261018120000_screening_interviews.sql).
  it("accepts what an invite stores", () => {
    expect(configSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("needs at least one competency and rejects unknown keys", () => {
    expect(configSnapshotSchema.safeParse({ ...snapshot, competencies: [] }).success).toBe(false);
    expect(configSnapshotSchema.safeParse({ ...snapshot, fit_threshold: 70 }).success).toBe(false);
  });
});

describe("transcriptCallbackSchema", () => {
  const turn = (id: number) => ({
    turn_id: id,
    timestamp: 1760780000 + id,
    user: "I designed the payments API.",
    assistant: "Tell me more.",
    interrupted: false,
  });
  const body = (overrides: Record<string, unknown> = {}) => ({
    voiceSessionId: "voice-1",
    interviewId: "00000000-0000-4000-8000-000000000001",
    turns: [turn(1), turn(2)],
    endReason: "completed",
    durationSeconds: 840,
    ...overrides,
  });

  it("accepts the voice server's body", () => {
    expect(transcriptCallbackSchema.parse(body())).toEqual(body());
  });

  it("accepts no turns (a rejected socket) and a null assistant line", () => {
    expect(transcriptCallbackSchema.safeParse(body({ turns: [], endReason: "error" })).success).toBe(true);
    expect(
      transcriptCallbackSchema.safeParse(body({ turns: [{ ...turn(1), assistant: null }] })).success,
    ).toBe(true);
  });

  it("allows at most 200 turns", () => {
    const turns = Array.from({ length: 200 }, (_, i) => turn(i));
    expect(transcriptCallbackSchema.safeParse(body({ turns })).success).toBe(true);
    expect(transcriptCallbackSchema.safeParse(body({ turns: [...turns, turn(200)] })).success).toBe(false);
  });

  it("caps the text of each turn", () => {
    expect(transcriptCallbackSchema.safeParse(body({ turns: [{ ...turn(1), user: repeat(4000) }] })).success).toBe(true);
    expect(transcriptCallbackSchema.safeParse(body({ turns: [{ ...turn(1), user: repeat(4001) }] })).success).toBe(false);
    expect(
      transcriptCallbackSchema.safeParse(body({ turns: [{ ...turn(1), assistant: repeat(4001) }] })).success,
    ).toBe(false);
  });

  it("only takes the voice server's end reasons (no_callback is the sweeper's)", () => {
    for (const reason of ["completed", "time_limit", "inactivity", "client_disconnect", "error"]) {
      expect(transcriptCallbackSchema.safeParse(body({ endReason: reason })).success).toBe(true);
    }
    expect(transcriptCallbackSchema.safeParse(body({ endReason: "no_callback" })).success).toBe(false);
    expect(END_REASONS).toContain("no_callback");
  });

  it("rejects unknown keys, a negative duration and a non-uuid interview id", () => {
    expect(transcriptCallbackSchema.safeParse(body({ score: 5 })).success).toBe(false);
    expect(transcriptCallbackSchema.safeParse(body({ turns: [{ ...turn(1), score: 5 }] })).success).toBe(false);
    expect(transcriptCallbackSchema.safeParse(body({ durationSeconds: -1 })).success).toBe(false);
    expect(transcriptCallbackSchema.safeParse(body({ interviewId: "nope" })).success).toBe(false);
  });

  it("accepts the voice server's payload fixture", () => {
    // The voice server (gethired-python-backend) builds exactly this payload in
    // tests/fixtures/transcript_callback.json; keep the two copies identical.
    expect(transcriptCallbackSchema.parse(callbackFixture)).toEqual(callbackFixture);
  });
});

describe("screeningReportSchema", () => {
  const report = (overrides: Record<string, unknown> = {}) => ({
    competencies: [
      {
        name: "System design",
        score: 4,
        rationale: "Explained the queue trade-offs.",
        evidence: [{ turnId: 3, quote: "we moved to a queue" }],
      },
      { name: "Communication", score: null, rationale: "Not assessed.", evidence: [] },
    ],
    questionCoverage: [{ question: "Why us?", asked: true, turnId: 2 }],
    summary: "Strong on design.",
    strengths: ["Clear trade-offs"],
    concerns: [],
    followUpQuestions: ["How would you shard it?"],
    ...overrides,
  });

  it("accepts a report, with null scores and an unasked question", () => {
    expect(
      screeningReportSchema.safeParse(
        report({ questionCoverage: [{ question: "Why us?", asked: false, turnId: null }] }),
      ).success,
    ).toBe(true);
  });

  it("keeps scores to whole numbers 1–5", () => {
    const withScore = (score: unknown) =>
      report({ competencies: [{ name: "X", score, rationale: "r", evidence: [] }] });
    expect(screeningReportSchema.safeParse(withScore(1)).success).toBe(true);
    expect(screeningReportSchema.safeParse(withScore(0)).success).toBe(false);
    expect(screeningReportSchema.safeParse(withScore(6)).success).toBe(false);
    expect(screeningReportSchema.safeParse(withScore(3.5)).success).toBe(false);
  });

  it("enforces the SI-REQ-031 limits", () => {
    const ok = (r: unknown) => screeningReportSchema.safeParse(r).success;
    const comp = (c: Record<string, unknown>) =>
      report({ competencies: [{ name: "X", score: 3, rationale: "r", evidence: [], ...c }] });
    expect(ok(comp({ rationale: repeat(400) }))).toBe(true);
    expect(ok(comp({ rationale: repeat(401) }))).toBe(false);
    expect(ok(comp({ evidence: [{ turnId: 1, quote: repeat(200) }] }))).toBe(true);
    expect(ok(comp({ evidence: [{ turnId: 1, quote: repeat(201) }] }))).toBe(false);
    expect(ok(report({ summary: repeat(600) }))).toBe(true);
    expect(ok(report({ summary: repeat(601) }))).toBe(false);
    expect(ok(report({ strengths: ["a", "b", "c", "d"] }))).toBe(false);
    expect(ok(report({ concerns: ["a", "b", "c", "d"] }))).toBe(false);
    expect(ok(report({ followUpQuestions: ["a", "b", "c", "d", "e", "f"] }))).toBe(false);
    expect(
      ok(report({ competencies: Array.from({ length: 6 }, () => ({ name: "X", score: 3, rationale: "r", evidence: [] })) })),
    ).toBe(false);
  });

  it("has no recommendation (SI-REQ-032)", () => {
    expect(screeningReportSchema.safeParse(report({ recommendation: "hire" })).success).toBe(false);
    expect(screeningReportSchema.safeParse(report({ overallScore: 4 })).success).toBe(false);
  });

  it("stores the computed overall score, still with no recommendation", () => {
    expect(storedScreeningReportSchema.safeParse(report({ overallScore: 3.5 })).success).toBe(true);
    expect(storedScreeningReportSchema.safeParse(report({ overallScore: null })).success).toBe(true);
    expect(
      storedScreeningReportSchema.safeParse(report({ overallScore: 3.5, recommendation: "hire" })).success,
    ).toBe(false);
  });
});

describe("consent", () => {
  it("has a version and names the company in the text", () => {
    expect(SCREENING_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const text = screeningConsentText("Acme");
    expect(text).toContain("Acme");
    expect(text).toMatch(/AI interviewer/);
    expect(text).toMatch(/transcribed/);
    expect(text).toMatch(/Audio isn't stored/);
  });
});
