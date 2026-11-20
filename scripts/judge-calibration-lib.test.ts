import { describe, expect, it, vi } from "vitest";
import { createArizeClient, queueSourceBatches, type ArizeSpan } from "./arize-lib";
import {
  calibrate,
  crossTabFeedback,
  currentVersion,
  drawSample,
  evaluationFilter,
  humanConfigName,
  humanVerdict,
  JUDGES,
  judgeVerdict,
  latestEvaluation,
  seededRandom,
  wilson,
  type Verdict,
} from "./judge-calibration-lib";

const span = (id: string, evaluations: ArizeSpan["evaluations"], over: Partial<ArizeSpan> = {}): ArizeSpan => ({
  name: "agent-chat",
  context: { trace_id: `t-${id}`, span_id: id },
  start_time: "2026-11-10T11:00:00Z",
  end_time: "2026-11-10T11:00:05Z",
  evaluations,
  ...over,
});

const evaluation = (label: string, version = "v2", timestamp = "2026-11-10T12:00:00Z") => ({
  name: "reply_groundedness",
  label,
  metadata: { evaluator_version_id: version, timestamp },
});

describe("judgeVerdict", () => {
  it("maps the judges' labels, and nothing else", () => {
    expect(judgeVerdict({ name: "x", label: "relevant" })).toBe("pass");
    expect(judgeVerdict({ name: "x", label: "irrelevant" })).toBe("fail");
    expect(judgeVerdict({ name: "x", label: "NOT_PARSABLE" })).toBeNull();
    expect(judgeVerdict({ name: "x", label: "" })).toBeNull();
  });
});

describe("latestEvaluation and currentVersion", () => {
  const s = span("a", [
    evaluation("irrelevant", "v1", "2026-11-01T00:00:00Z"),
    evaluation("relevant", "v2", "2026-11-20T00:00:00Z"),
  ]);

  it("takes the newest score, or the newest from one version", () => {
    expect(latestEvaluation(s, "reply_groundedness")?.label).toBe("relevant");
    expect(latestEvaluation(s, "reply_groundedness", "v1")?.label).toBe("irrelevant");
  });

  it("calls the version that scored last the current one", () => {
    expect(currentVersion([s], "reply_groundedness")).toBe("v2");
  });
});

describe("drawSample", () => {
  const spans = [
    ...Array.from({ length: 50 }, (_, i) => span(`p${i}`, [evaluation("relevant")])),
    ...Array.from({ length: 5 }, (_, i) => span(`f${i}`, [evaluation("irrelevant")])),
    span("old", [evaluation("irrelevant", "v1")]),
    span("broken", [evaluation("NOT_PARSABLE")]),
  ];

  it("counts each stratum and takes up to perStratum of each", () => {
    const { population, sample } = drawSample(spans, {
      evaluation: "reply_groundedness",
      versionId: "v2",
      perStratum: 10,
      seed: 1,
    });
    expect(population).toEqual({ pass: 50, fail: 5 });
    expect(sample.filter((s) => s.judge === "fail")).toHaveLength(5);
    expect(sample.filter((s) => s.judge === "pass")).toHaveLength(10);
    expect(sample.map((s) => s.spanId)).not.toContain("old");
  });

  it("draws the same sample for the same seed", () => {
    const draw = (seed: number) =>
      drawSample(spans, { evaluation: "reply_groundedness", perStratum: 10, seed }).sample.map((s) => s.spanId);
    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
  });

  it("keeps one role, and counts a span listed twice once", () => {
    const mixed = [
      span("a", [evaluation("relevant")], { attributes: { "gethired.role": "company" } }),
      span("a", [evaluation("relevant")], { attributes: { "gethired.role": "company" } }),
      span("b", [evaluation("relevant")], { attributes: { "gethired.role": "applicant" } }),
    ];
    const { population, sample } = drawSample(mixed, {
      evaluation: "reply_groundedness",
      role: "company",
      perStratum: 10,
      seed: 1,
    });
    expect(population).toEqual({ pass: 1, fail: 0 });
    expect(sample).toEqual([expect.objectContaining({ spanId: "a", role: "company" })]);
  });
});

describe("seededRandom", () => {
  it("stays in [0, 1)", () => {
    const random = seededRandom(42);
    for (let i = 0; i < 1000; i++) {
      const x = random();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("evaluationFilter", () => {
  it("filters by label when the name allows it, else by the judge's scope", () => {
    expect(evaluationFilter("reply_groundedness")).toBe(
      "eval.reply_groundedness.label = 'relevant' or eval.reply_groundedness.label = 'irrelevant'",
    );
    const relevance = JUDGES.find((j) => j.evaluation === "Main Agent Request Relevance");
    expect(evaluationFilter("Main Agent Request Relevance", relevance)).toBe("attributes.agent.name = 'agent-chat'");
    expect(evaluationFilter("Some Other Judge")).toBeUndefined();
  });

  it("gives every judge with a spaced name a scope", () => {
    for (const judge of JUDGES) expect(evaluationFilter(judge.evaluation, judge)).toBeTruthy();
  });
});

describe("humanConfigName and humanVerdict", () => {
  it("names a filterable config per eval", () => {
    expect(humanConfigName("Main Agent Request Relevance")).toBe("judge_check_main_agent_request_relevance");
    expect(humanConfigName("reply_groundedness")).toBe("judge_check_reply_groundedness");
  });

  it("reads the hand label off the span", () => {
    const s = span("a", [], { annotations: [{ name: "judge_check_x", label: "fail" }] });
    expect(humanVerdict(s, "judge_check_x")).toBe("fail");
    expect(humanVerdict(s, "judge_check_y")).toBeNull();
  });
});

describe("wilson", () => {
  it("brackets the estimate and stays in [0, 1]", () => {
    const i = wilson(9, 10)!;
    expect(i.estimate).toBe(0.9);
    expect(i.low).toBeCloseTo(0.596, 2);
    expect(i.high).toBeCloseTo(0.982, 2);
    expect(wilson(0, 5)!.low).toBe(0);
    expect(wilson(0, 0)).toBeNull();
  });
});

describe("calibrate", () => {
  const items = (judge: Verdict, agree: number, disagree: number) => [
    ...Array.from({ length: agree }, () => ({ judge, human: judge })),
    ...Array.from({ length: disagree }, () => ({ judge, human: (judge === "pass" ? "fail" : "pass") as Verdict })),
  ];

  it("is perfect when every label agrees", () => {
    const c = calibrate([...items("fail", 10, 0), ...items("pass", 10, 0)], { fail: 100, pass: 900 });
    expect(c.accuracy).toBe(1);
    expect(c.failRecall).toBe(1);
    expect(c.kappa).toBeCloseTo(1);
    expect(c.trueFailRate).toBeCloseTo(0.1);
  });

  it("re-weights the strata to the population", () => {
    // Judge fails 10% of spans; half its fails are real; 10% of its passes are real fails.
    const c = calibrate([...items("fail", 10, 10), ...items("pass", 18, 2)], { fail: 100, pass: 900 });
    expect(c.failPrecision?.estimate).toBe(0.5);
    expect(c.passPrecision?.estimate).toBe(0.9);
    // Population: both fail 0.05, both pass 0.81, judge-pass/human-fail 0.09.
    expect(c.accuracy).toBeCloseTo(0.86);
    expect(c.trueFailRate).toBeCloseTo(0.14);
    expect(c.failRecall).toBeCloseTo(0.05 / 0.14);
    expect(c.judgeFailRate).toBeCloseTo(0.1);
    // Chance = 0.1·0.14 + 0.9·0.86 = 0.788.
    expect(c.kappa).toBeCloseTo((0.86 - 0.788) / (1 - 0.788));
  });

  it("gives no population estimate while a stratum is unlabelled", () => {
    const c = calibrate(items("fail", 5, 0), { fail: 10, pass: 90 });
    expect(c.failPrecision?.estimate).toBe(1);
    expect(c.accuracy).toBeNull();
    expect(c.judgeFailRate).toBeCloseTo(0.1);
  });

  it("works when the judge never failed anything", () => {
    const c = calibrate(items("pass", 9, 1), { fail: 0, pass: 500 });
    expect(c.accuracy).toBeCloseTo(0.9);
    expect(c.failRecall).toBe(0);
    expect(c.failPrecision).toBeNull();
  });
});

describe("crossTabFeedback", () => {
  it("counts votes against the eval's verdicts", () => {
    const rated = (id: string, rating: string, label: string) =>
      span(id, [evaluation(label)], { annotations: [{ name: "user_rating", label: rating }] });
    const t = crossTabFeedback(
      [rated("a", "down", "irrelevant"), rated("b", "down", "relevant"), rated("c", "up", "relevant"), span("d", [])],
      "reply_groundedness",
      "user_rating",
    );
    expect(t).toEqual({ down: { fail: 1, pass: 1 }, up: { fail: 0, pass: 1 } });
  });
});

describe("queueSourceBatches", () => {
  it("splits spans into 7-day, 500-span sources", () => {
    const day = (d: number) => new Date(Date.UTC(2026, 10, 1 + d)).toISOString();
    const spans = [
      ...Array.from({ length: 600 }, (_, i) => ({ spanId: `a${i}`, startTime: day(0) })),
      { spanId: "late", startTime: day(10) },
    ];
    const batches = queueSourceBatches(spans);
    expect(batches.map((b) => b.spanIds.length)).toEqual([500, 100, 1]);
    for (const b of batches) expect(b.end.getTime() - b.start.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
  });
});

describe("createArizeClient", () => {
  it("pages with the cursor in the query string and the same body", async () => {
    const bodies: string[] = [];
    const urls: string[] = [];
    const pages = [
      { spans: [span("a", [])], pagination: { has_more: true, next_cursor: "c2" } },
      { spans: [span("b", [])], pagination: { has_more: false } },
    ];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url);
      bodies.push(String(init.body));
      return new Response(JSON.stringify(pages.shift()), { status: 200 });
    });
    const client = createArizeClient({ apiKey: "k", spaceId: "s", fetchImpl: fetchImpl as never });
    const ids: string[] = [];
    for await (const s of client.listSpans({ start: new Date(0), end: new Date(1000) })) ids.push(s.context.span_id);

    expect(ids).toEqual(["a", "b"]);
    expect(urls[1]).toContain("cursor=c2");
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[0]).not.toContain("cursor");
  });

  it("waits out a 429 and retries", async () => {
    const sleep = vi.fn(async () => {});
    const responses = [
      new Response("", { status: 429, headers: { "retry-after": "3" } }),
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ];
    const client = createArizeClient({
      apiKey: "k",
      spaceId: "s",
      fetchImpl: (async () => responses.shift()!) as never,
      sleep,
      log: () => {},
    });
    expect(await client.request("GET", "/x")).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("refuses an annotation window over 31 days", async () => {
    const client = createArizeClient({ apiKey: "k", spaceId: "s", fetchImpl: vi.fn() as never });
    await expect(
      client.annotateSpans({ records: [], start: new Date(0), end: new Date(32 * 86_400_000) }),
    ).rejects.toThrow(/31 days/);
  });
});
