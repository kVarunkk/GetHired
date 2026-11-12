import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { claimForRun, notUnderLiveClaim, transition, transitionMany } from "./transition";

describe("notUnderLiveClaim", () => {
  it("allows any row but one in processing under another run's live claim", () => {
    const now = Date.parse("2026-11-10T10:10:00.000Z");
    expect(
      notUnderLiveClaim({ claim: "2026-11-10T10:09:00.000Z", liveForMs: 120_000, now }),
    ).toBe(
      'status.neq.processing,claimed_at.is.null,claimed_at.lte."2026-11-10T10:08:00.000Z",claimed_at.eq."2026-11-10T10:09:00.000Z"',
    );
  });

  it("uses another lifecycle column when told to", () => {
    expect(
      notUnderLiveClaim({ column: "explanation_status", claim: "c", liveForMs: 0, now: 0 }).startsWith(
        "explanation_status.neq.processing,",
      ),
    ).toBe(true);
  });
});

describe("transition", () => {
  it("moves one row from the allowed states and says it applied", async () => {
    const mock = createSupabaseMock();
    mock.queue("interview_analyses", { data: [{ id: "a1" }], error: null });

    const result = await transition(
      mock.client,
      "interview_analyses",
      { id: "a1" },
      { from: ["queued", "failed"], to: "processing", patch: { error_code: null } },
    );

    expect(result).toEqual({ applied: true });
    const [call] = mock.callsFor("interview_analyses");
    expect(call.chain).toEqual([
      { method: "update", args: [{ status: "processing", error_code: null }] },
      { method: "eq", args: ["id", "a1"] },
      { method: "in", args: ["status", ["queued", "failed"]] },
      { method: "select", args: ["id"] },
    ]);
  });

  it("filters on the claim when one is given", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_screenings", { data: [{ id: "s1" }], error: null });

    await transition(
      mock.client,
      "application_screenings",
      { id: "s1", claim: "2026-11-10T10:00:00.000Z" },
      { from: ["processing"], to: "completed" },
    );

    const [call] = mock.callsFor("application_screenings");
    expect(call.chain).toContainEqual({ method: "eq", args: ["claimed_at", "2026-11-10T10:00:00.000Z"] });
    expect(call.chain.at(-1)).toEqual({ method: "select", args: ["id"] });
  });

  it("uses another lifecycle column when told to", async () => {
    const mock = createSupabaseMock();
    mock.queue("job_relevant_profiles", { data: [], error: null });

    const result = await transition(
      mock.client,
      "job_relevant_profiles",
      { id: "r1", column: "explanation_status" },
      { from: ["processing"], to: "completed", patch: { explanation: "x" } },
    );

    expect(result).toEqual({ applied: false });
    const [call] = mock.callsFor("job_relevant_profiles");
    expect(call.chain[0]).toEqual({ method: "update", args: [{ explanation_status: "completed", explanation: "x" }] });
    expect(call.chain).toContainEqual({ method: "in", args: ["explanation_status", ["processing"]] });
  });

  it("returns applied: false when no row is in an allowed state", async () => {
    const mock = createSupabaseMock();
    mock.queue("interview_analyses", { data: [], error: null });

    await expect(
      transition(mock.client, "interview_analyses", { id: "a1" }, { from: ["processing"], to: "completed" }),
    ).resolves.toEqual({ applied: false });
  });

  it("throws on a database error", async () => {
    const mock = createSupabaseMock();
    mock.queue("interview_analyses", { data: null, error: { message: "boom" } });

    await expect(
      transition(mock.client, "interview_analyses", { id: "a1" }, { from: ["processing"], to: "completed" }),
    ).rejects.toThrow(/boom/);
  });

  it("refuses an empty from list", async () => {
    const mock = createSupabaseMock();
    await expect(
      transition(
        mock.client,
        "interview_analyses",
        { id: "a1" },
        // @ts-expect-error: from must name at least one state
        { from: [], to: "completed" },
      ),
    ).rejects.toThrow(/from/);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("transitionMany", () => {
  it("moves the listed rows and returns the ids that moved", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_screenings", { data: [{ application_id: "app1" }], error: null });

    const result = await transitionMany(
      mock.client,
      "application_screenings",
      { key: "application_id", ids: ["app1", "app2"], match: { job_post_id: "job1" } },
      { from: ["queued"], to: "failed", patch: { error_code: "worker_error" } },
    );

    expect(result).toEqual({ applied: ["app1"] });
    const [call] = mock.callsFor("application_screenings");
    expect(call.chain).toEqual([
      { method: "update", args: [{ status: "failed", error_code: "worker_error" }] },
      { method: "in", args: ["application_id", ["app1", "app2"]] },
      { method: "eq", args: ["job_post_id", "job1"] },
      { method: "in", args: ["status", ["queued"]] },
      { method: "select", args: ["application_id"] },
    ]);
  });

  it("defaults the key to id", async () => {
    const mock = createSupabaseMock();
    mock.queue("job_relevant_profiles", { data: [{ id: "r1" }, { id: "r2" }], error: null });

    const result = await transitionMany(
      mock.client,
      "job_relevant_profiles",
      { ids: ["r1", "r2"], column: "explanation_status" },
      { from: ["none", "stale"], to: "queued" },
    );

    expect(result).toEqual({ applied: ["r1", "r2"] });
    const [call] = mock.callsFor("job_relevant_profiles");
    expect(call.chain).toContainEqual({ method: "in", args: ["id", ["r1", "r2"]] });
    expect(call.chain.at(-1)).toEqual({ method: "select", args: ["id"] });
  });

  it("can select by match alone", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_screenings", { data: [], error: null });

    await transitionMany(
      mock.client,
      "application_screenings",
      { key: "application_id", match: { job_post_id: "job1" } },
      { from: ["completed"], to: "stale" },
    );

    const [call] = mock.callsFor("application_screenings");
    expect(call.chain.some((c) => c.method === "in" && c.args[0] === "application_id")).toBe(false);
    expect(call.chain).toContainEqual({ method: "eq", args: ["job_post_id", "job1"] });
  });

  it("does nothing for an empty id list", async () => {
    const mock = createSupabaseMock();
    await expect(
      transitionMany(mock.client, "application_screenings", { ids: [] }, { from: ["queued"], to: "failed" }),
    ).resolves.toEqual({ applied: [] });
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses a write with neither ids nor match", async () => {
    const mock = createSupabaseMock();
    await expect(
      transitionMany(mock.client, "application_screenings", {}, { from: ["queued"], to: "failed" }),
    ).rejects.toThrow(/ids or match/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses an empty from list and throws on a database error", async () => {
    const mock = createSupabaseMock();
    await expect(
      transitionMany(
        mock.client,
        "application_screenings",
        { ids: ["a"] },
        // @ts-expect-error: from must name at least one state
        { from: [], to: "failed" },
      ),
    ).rejects.toThrow(/from/);

    mock.queue("application_screenings", { data: null, error: { message: "nope" } });
    await expect(
      transitionMany(mock.client, "application_screenings", { ids: ["a"] }, { from: ["queued"], to: "failed" }),
    ).rejects.toThrow(/nope/);
  });
});

describe("transition with a null claim", () => {
  it("matches a row with no claim through is()", async () => {
    const mock = createSupabaseMock();
    mock.queue("interview_analyses", { data: [{ id: "a1" }], error: null });

    await transition(mock.client, "interview_analyses", { id: "a1", claim: null }, { from: ["processing"], to: "failed" });

    const [call] = mock.callsFor("interview_analyses");
    expect(call.chain).toContainEqual({ method: "is", args: ["claimed_at", null] });
  });
});

describe("claimForRun", () => {
  const NOW = Date.parse("2026-11-10T10:10:00.000Z");
  const claim = new Date(NOW).toISOString();
  const opts = { from: ["queued", "failed"] as const, claim, liveForMs: 300_000, now: NOW };

  it("claims a row in a start state, filtering on the state it read", async () => {
    const mock = createSupabaseMock();
    mock.queue("interview_analyses", { data: [{ id: "a1" }], error: null });

    const result = await claimForRun(
      mock.client,
      "interview_analyses",
      { id: "a1", state: "failed", claimedAt: null },
      { ...opts, patch: { error_code: null } },
    );

    expect(result).toBe("claimed");
    const [call] = mock.callsFor("interview_analyses");
    expect(call.chain).toEqual([
      { method: "update", args: [{ status: "processing", error_code: null, claimed_at: claim }] },
      { method: "eq", args: ["id", "a1"] },
      { method: "in", args: ["status", ["failed"]] },
      { method: "select", args: ["id"] },
    ]);
  });

  it("is lost when another run moved the row first", async () => {
    const mock = createSupabaseMock();
    mock.queue("interview_analyses", { data: [], error: null });

    await expect(
      claimForRun(mock.client, "interview_analyses", { id: "a1", state: "queued", claimedAt: null }, opts),
    ).resolves.toBe("lost");
  });

  it("leaves a live claim alone without writing", async () => {
    const mock = createSupabaseMock();
    const claimedAt = new Date(NOW - 299_000).toISOString();

    await expect(
      claimForRun(mock.client, "interview_analyses", { id: "a1", state: "processing", claimedAt }, opts),
    ).resolves.toBe("busy");
    expect(mock.calls).toHaveLength(0);
  });

  it("re-claims a dead claim, filtering on the old claim", async () => {
    const mock = createSupabaseMock();
    mock.queue("interview_analyses", { data: [{ id: "a1" }], error: null });
    const claimedAt = new Date(NOW - 300_000).toISOString();

    await expect(
      claimForRun(mock.client, "interview_analyses", { id: "a1", state: "processing", claimedAt }, opts),
    ).resolves.toBe("claimed");
    const [call] = mock.callsFor("interview_analyses");
    expect(call.chain).toEqual([
      { method: "update", args: [{ status: "processing", claimed_at: claim }] },
      { method: "eq", args: ["id", "a1"] },
      { method: "in", args: ["status", ["processing"]] },
      { method: "eq", args: ["claimed_at", claimedAt] },
      { method: "select", args: ["id"] },
    ]);
  });

  it("treats processing with no claim (before claims existed) as dead", async () => {
    const mock = createSupabaseMock();
    mock.queue("interview_analyses", { data: [{ id: "a1" }], error: null });

    await expect(
      claimForRun(mock.client, "interview_analyses", { id: "a1", state: "processing", claimedAt: null }, opts),
    ).resolves.toBe("claimed");
    expect(mock.callsFor("interview_analyses")[0].chain).toContainEqual({ method: "is", args: ["claimed_at", null] });
  });

  it("is lost for a state it may not start from", async () => {
    const mock = createSupabaseMock();
    await expect(
      claimForRun(mock.client, "interview_analyses", { id: "a1", state: "completed", claimedAt: null }, opts),
    ).resolves.toBe("lost");
    expect(mock.calls).toHaveLength(0);
  });

  it("works on another lifecycle column", async () => {
    const mock = createSupabaseMock();
    mock.queue("job_relevant_profiles", { data: [{ id: "r1" }], error: null });

    await claimForRun(
      mock.client,
      "job_relevant_profiles",
      { id: "r1", state: "stale", claimedAt: null },
      { from: ["queued", "stale"], claim, liveForMs: 120_000, now: NOW, column: "explanation_status" },
    );
    const [call] = mock.callsFor("job_relevant_profiles");
    expect(call.chain[0]).toEqual({ method: "update", args: [{ explanation_status: "processing", claimed_at: claim }] });
    expect(call.chain).toContainEqual({ method: "in", args: ["explanation_status", ["stale"]] });
  });
});
