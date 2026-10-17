import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, COMPANY_B, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { pipelineAppOf, stageOf, templateOf } from "@/test/utils/pipeline";
import { sendCompanyMessage } from "@/helpers/email/send-company-message";
import { MAX_MOVE_APPLICATIONS, PL_DAILY_EMAIL_CAP, actorName, moveApplications, previewMove } from "./move";
import { MEMBER_A, OWNER_A } from "@/test/utils/team";
import { mockUser } from "@/test/utils/auth";

vi.mock("@/helpers/email/send-company-message", () => ({ sendCompanyMessage: vi.fn() }));

let supabase: SupabaseMock;
const ctx = () => ({ supabase: supabase.client, company: OWNER_A.myCompany, user: COMPANY_A.user });

const INTERVIEW = stageOf("interview");
const SCREENING = stageOf("screening");

/** An application as the move query loads it: with its current stage's kind. */
function loaded(app = pipelineAppOf(), kind: "applied" | "screening" | "interview" = "applied") {
  return { ...app, pipeline_stages: { kind } };
}

const appCalls = () => supabase.callsFor("applications");
const updates = () => appCalls().filter((c) => c.chain.some((m) => m.method === "update"));
const eventInserts = () =>
  supabase.callsFor("application_events").filter((c) => c.chain.some((m) => m.method === "insert"));
const argsOf = (chain: { method: string; args: unknown[] }[], method: string) =>
  chain.find((c) => c.method === method)?.args;

beforeEach(() => {
  supabase = createSupabaseMock({ user: COMPANY_A.user });
});

describe("moveApplications input (PL-TEST-002)", () => {
  it(`refuses more than ${MAX_MOVE_APPLICATIONS} ids without a query`, async () => {
    const ids = Array.from({ length: MAX_MOVE_APPLICATIONS + 1 }, () => pipelineAppOf().id);

    expect(await moveApplications(ctx(), { applicationIds: ids, stageId: INTERVIEW.id })).toMatchObject({
      ok: false,
    });
    expect(supabase.calls).toHaveLength(0);
  });

  it.each([
    ["no ids", { applicationIds: [], stageId: INTERVIEW.id }],
    ["a non-UUID id", { applicationIds: ["1; drop table"], stageId: INTERVIEW.id }],
    ["a non-UUID stage", { applicationIds: [pipelineAppOf().id], stageId: "nope" }],
  ])("rejects %s without a query", async (_, input) => {
    expect(await moveApplications(ctx(), input)).toMatchObject({ ok: false });
    expect(supabase.calls).toHaveLength(0);
  });

  it.each([
    ["an unknown stage", null],
    ["an archived stage", { ...INTERVIEW, archived: true }],
  ])("refuses %s, scoped to the session company", async (_, stage) => {
    supabase.queue("pipeline_stages", { data: stage, error: null });

    expect(
      await moveApplications(ctx(), { applicationIds: [pipelineAppOf().id], stageId: INTERVIEW.id }),
    ).toEqual({ ok: false, error: "Stage not found." });

    const [load] = supabase.callsFor("pipeline_stages");
    expect(load.chain).toContainEqual({ method: "eq", args: ["id", INTERVIEW.id] });
    expect(load.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(appCalls()).toHaveLength(0);
  });
});

describe("moveApplications (PL-TEST-002)", () => {
  beforeEach(() => {
    supabase.queue("pipeline_stages", { data: INTERVIEW, error: null });
  });

  it("skips another company's, missing and off-platform applications as not_found", async () => {
    const mine = loaded();
    const theirs = pipelineAppOf({
      job_postings: { ...pipelineAppOf().job_postings, company_id: COMPANY_B.id },
    });
    const offPlatform = pipelineAppOf({ job_post_id: null, stage_id: null });
    const missing = "ab000000-0000-4000-8000-00000000ffff";
    // RLS and the company filter only return company A's platform rows.
    supabase.queue("applications", { data: [mine], error: null });

    const result = await moveApplications(ctx(), {
      applicationIds: [mine.id, theirs.id, offPlatform.id, missing],
      stageId: INTERVIEW.id,
    });

    expect(result).toMatchObject({ ok: true, moved: 1, emailed: 0 });
    if (!result.ok) throw new Error("expected ok");
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { id: theirs.id, reason: "not_found" },
        { id: offPlatform.id, reason: "not_found" },
        { id: missing, reason: "not_found" },
      ]),
    );
    expect(result.skipped).toHaveLength(3);

    const [load] = appCalls();
    expect(argsOf(load.chain, "in")).toEqual(["id", [mine.id, theirs.id, offPlatform.id, missing]]);
    expect(load.chain).toContainEqual({
      method: "eq",
      args: ["job_postings.company_id", COMPANY_A.id],
    });
    expect(String(argsOf(load.chain, "select")?.[0]).replace(/\s+/g, "")).toContain("job_postings!inner(");
  });

  it("skips applications already in the stage", async () => {
    const already = loaded(pipelineAppOf({ stage_id: INTERVIEW.id }), "interview");
    const moving = loaded();
    supabase.queue("applications", { data: [already, moving], error: null });

    const result = await moveApplications(ctx(), {
      applicationIds: [already.id, moving.id],
      stageId: INTERVIEW.id,
    });

    expect(result).toMatchObject({
      ok: true,
      moved: 1,
      skipped: [{ id: already.id, reason: "already_in_stage" }],
    });
    expect(argsOf(updates()[0].chain, "in")).toEqual(["id", [moving.id]]);
  });

  it("moves in one update that sets stage_id, never status (the trigger does)", async () => {
    const apps = [loaded(), loaded(pipelineAppOf({ stage_id: SCREENING.id }), "screening")];
    supabase.queue("applications", { data: apps, error: null });

    await moveApplications(ctx(), { applicationIds: apps.map((a) => a.id), stageId: INTERVIEW.id });

    expect(updates()).toHaveLength(1);
    const [update] = updates();
    const payload = argsOf(update.chain, "update")?.[0];
    expect(payload).toMatchObject({ stage_id: INTERVIEW.id });
    expect(payload).not.toHaveProperty("status");
    expect(argsOf(update.chain, "in")).toEqual(["id", apps.map((a) => a.id)]);
  });

  it("writes one stage_changed event per moved application, in one insert", async () => {
    const fromApplied = loaded();
    const fromScreening = loaded(pipelineAppOf({ stage_id: SCREENING.id }), "screening");
    supabase.queue("applications", { data: [fromApplied, fromScreening], error: null });

    expect(
      await moveApplications(ctx(), {
        applicationIds: [fromApplied.id, fromScreening.id],
        stageId: INTERVIEW.id,
      }),
    ).toMatchObject({ ok: true, moved: 2, emailed: 0, skipped: [] });

    expect(eventInserts()).toHaveLength(1);
    const rows = argsOf(eventInserts()[0].chain, "insert")?.[0];
    expect(rows).toEqual([
      {
        company_id: COMPANY_A.id,
        application_id: fromApplied.id,
        candidate_user_id: fromApplied.applicant_user_id,
        actor_user_id: COMPANY_A.user.id,
        actor_name: expect.any(String),
        type: "stage_changed",
        payload: {
          from_stage_id: stageOf("applied").id,
          to_stage_id: INTERVIEW.id,
          from_kind: "applied",
          to_kind: "interview",
        },
      },
      expect.objectContaining({
        application_id: fromScreening.id,
        payload: {
          from_stage_id: SCREENING.id,
          to_stage_id: INTERVIEW.id,
          from_kind: "screening",
          to_kind: "interview",
        },
      }),
    ]);
  });

  it("does nothing when every application is skipped", async () => {
    supabase.queue("applications", { data: [], error: null });

    expect(
      await moveApplications(ctx(), { applicationIds: [pipelineAppOf().id], stageId: INTERVIEW.id }),
    ).toMatchObject({ ok: true, moved: 0 });
    expect(updates()).toHaveLength(0);
    expect(eventInserts()).toHaveLength(0);
  });

  it("returns { ok: false } and writes no events when the update fails", async () => {
    const app = loaded();
    supabase.queue("applications", { data: [app], error: null });
    supabase.queue("applications", { data: null, error: { message: "denied" } });

    expect(
      await moveApplications(ctx(), { applicationIds: [app.id], stageId: INTERVIEW.id }),
    ).toMatchObject({ ok: false });
    expect(updates()).toHaveLength(1);
    expect(eventInserts()).toHaveLength(0);
  });

  it("returns { ok: false } when the applications can't be loaded", async () => {
    supabase.queue("applications", { data: null, error: { message: "boom" } });

    expect(
      await moveApplications(ctx(), { applicationIds: [pipelineAppOf().id], stageId: INTERVIEW.id }),
    ).toMatchObject({ ok: false });
    expect(updates()).toHaveLength(0);
  });

  it("dedupes repeated ids", async () => {
    const app = loaded();
    supabase.queue("applications", { data: [app], error: null });

    expect(
      await moveApplications(ctx(), { applicationIds: [app.id, app.id], stageId: INTERVIEW.id }),
    ).toMatchObject({ ok: true, moved: 1, skipped: [] });
    expect(argsOf(appCalls()[0].chain, "in")).toEqual(["id", [app.id]]);
  });
});

describe("moveApplications with email (PLT-061, PL-TEST-002, PL-SEC-005)", () => {
  const ADVANCE = templateOf("advance");
  const COMPANY_SETTINGS = {
    name: COMPANY_A.info.name,
    email: COMPANY_A.info.email,
    logo_url: null,
    scheduling_url: null,
  };

  /** Interview is the target; the template, company settings and today's email count. */
  function setUp({
    template = ADVANCE as ReturnType<typeof templateOf> | null,
    settings = COMPANY_SETTINGS,
    sentToday = 0,
  } = {}) {
    supabase.queue("pipeline_stages", { data: INTERVIEW, error: null });
    supabase.queue("company_email_templates", { data: template, error: null });
    supabase.queue("company_info", { data: settings, error: null });
    supabase.queue("application_events", { data: null, error: null, count: sentToday });
  }

  const sent = () => vi.mocked(sendCompanyMessage).mock.calls.map(([args]) => args);
  const insertedEvents = () =>
    eventInserts().flatMap((c) => argsOf(c.chain, "insert")?.[0] as Record<string, unknown>[]);

  beforeEach(() => {
    vi.mocked(sendCompanyMessage).mockReset().mockResolvedValue({ ok: true });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("emails only the applications whose candidate-facing status changes", async () => {
    setUp();
    const fromApplied = loaded();
    const fromScreening = loaded(pipelineAppOf({ stage_id: SCREENING.id }), "screening");
    supabase.queue("applications", { data: [fromApplied, fromScreening], error: null });

    const result = await moveApplications(ctx(), {
      applicationIds: [fromApplied.id, fromScreening.id],
      stageId: INTERVIEW.id,
      email: { templateId: ADVANCE.id },
    });

    expect(result).toMatchObject({ ok: true, moved: 2, emailed: 1, skipped: [] });
    expect(sent()).toHaveLength(1);
    // The recipient comes from user_info loaded from the DB; reply-to is the company's email.
    expect(sent()[0]).toEqual({
      toEmail: PUBLIC_APPLICANT.info.email,
      subject: "Next steps for Founding Backend Engineer",
      bodyMd: expect.stringContaining("Hi Ada,"),
      companyName: COMPANY_A.info.name,
      companyEmail: COMPANY_A.info.email,
      logoUrl: null,
    });
  });

  it("emails every moved application with a custom template", async () => {
    setUp({ template: templateOf("custom") });
    const fromApplied = loaded();
    const fromScreening = loaded(pipelineAppOf({ stage_id: SCREENING.id }), "screening");
    supabase.queue("applications", { data: [fromApplied, fromScreening], error: null });

    const result = await moveApplications(ctx(), {
      applicationIds: [fromApplied.id, fromScreening.id],
      stageId: INTERVIEW.id,
      email: { templateId: templateOf("custom").id },
    });

    expect(result).toMatchObject({ ok: true, emailed: 2 });
  });

  it("scopes the template to the session company", async () => {
    setUp({ template: null });
    supabase.queue("applications", { data: [loaded()], error: null });

    const result = await moveApplications(ctx(), {
      applicationIds: [pipelineAppOf().id],
      stageId: INTERVIEW.id,
      email: { templateId: ADVANCE.id },
    });

    expect(result).toEqual({ ok: false, error: "Template not found." });
    const [load] = supabase.callsFor("company_email_templates");
    expect(load.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(updates()).toHaveLength(0);
  });

  it("renders the overrides instead of the stored template", async () => {
    setUp();
    const app = loaded();
    supabase.queue("applications", { data: [app], error: null });

    await moveApplications(ctx(), {
      applicationIds: [app.id],
      stageId: INTERVIEW.id,
      email: {
        templateId: ADVANCE.id,
        overrides: { subject: "Hi {{candidate_first_name}}", body: "About {{job_title}}" },
      },
    });

    expect(sent()[0]).toMatchObject({ subject: "Hi Ada", bodyMd: "About Founding Backend Engineer" });
  });

  it("keeps the template's body when only the subject is overridden (the agent's edits)", async () => {
    setUp();
    const app = loaded();
    supabase.queue("applications", { data: [app], error: null });

    await moveApplications(ctx(), {
      applicationIds: [app.id],
      stageId: INTERVIEW.id,
      email: { templateId: ADVANCE.id, overrides: { subject: "Quick update, {{candidate_first_name}}" } },
    });

    expect(sent()[0]).toMatchObject({
      subject: "Quick update, Ada",
      bodyMd: expect.stringContaining("Hi Ada,"),
    });
  });

  describe("previewMove (RA-TASK-040)", () => {
    it("shows who moves, who's emailed and the first message, without writing or sending", async () => {
      setUp();
      const fromApplied = loaded();
      const fromScreening = loaded(pipelineAppOf({ stage_id: SCREENING.id }), "screening");
      const inInterview = loaded(pipelineAppOf({ stage_id: INTERVIEW.id }), "interview");
      supabase.queue("applications", { data: [fromApplied, fromScreening, inInterview], error: null });
      const missing = "e0000000-0000-4000-8000-0000000000aa";

      const result = await previewMove(ctx(), {
        applicationIds: [fromApplied.id, fromScreening.id, inInterview.id, missing],
        stageId: INTERVIEW.id,
        email: { templateId: ADVANCE.id },
      });

      expect(result).toEqual({
        ok: true,
        stage: { id: INTERVIEW.id, name: INTERVIEW.name, kind: "interview" },
        applications: [
          { id: fromApplied.id, name: "Ada Lovelace", jobTitle: "Founding Backend Engineer", moves: true, emailed: true },
          { id: fromScreening.id, name: "Ada Lovelace", jobTitle: "Founding Backend Engineer", moves: true, emailed: false },
          { id: inInterview.id, name: "Ada Lovelace", jobTitle: "Founding Backend Engineer", moves: false, emailed: false },
        ],
        notFound: 1,
        email: {
          subject: "Next steps for Founding Backend Engineer",
          body: expect.stringContaining("Hi Ada,"),
          recipients: 1,
        },
      });
      expect(updates()).toHaveLength(0);
      expect(eventInserts()).toHaveLength(0);
      expect(sendCompanyMessage).not.toHaveBeenCalled();
    });

    it("refuses what the move would refuse", async () => {
      setUp({ sentToday: PL_DAILY_EMAIL_CAP });
      const app = loaded();
      supabase.queue("applications", { data: [app], error: null });

      const result = await previewMove(ctx(), {
        applicationIds: [app.id],
        stageId: INTERVIEW.id,
        email: { templateId: ADVANCE.id },
      });

      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("0 left today") });
    });

    it("has no email without one", async () => {
      supabase.queue("pipeline_stages", { data: INTERVIEW, error: null });
      const app = loaded();
      supabase.queue("applications", { data: [app], error: null });

      const result = await previewMove(ctx(), { applicationIds: [app.id], stageId: INTERVIEW.id });

      expect(result).toMatchObject({ ok: true, email: null, notFound: 0 });
    });
  });

  it("refuses to move or send while unknown variables remain", async () => {
    setUp();
    const app = loaded();
    supabase.queue("applications", { data: [app], error: null });

    const result = await moveApplications(ctx(), {
      applicationIds: [app.id],
      stageId: INTERVIEW.id,
      email: { templateId: ADVANCE.id, overrides: { subject: "Hi", body: "{{salary}} and {{ foo }}" } },
    });

    expect(result).toMatchObject({ ok: false, unknownVariables: ["salary", "foo"] });
    expect(updates()).toHaveLength(0);
    expect(sendCompanyMessage).not.toHaveBeenCalled();
  });

  it("refuses an interview invite when the company has no scheduling link", async () => {
    setUp({ template: templateOf("interview_invite") });
    const app = loaded();
    supabase.queue("applications", { data: [app], error: null });

    const result = await moveApplications(ctx(), {
      applicationIds: [app.id],
      stageId: INTERVIEW.id,
      email: { templateId: templateOf("interview_invite").id },
    });

    expect(result).toMatchObject({ ok: false, missingVariables: ["scheduling_link"] });
    expect(updates()).toHaveLength(0);
  });

  it(`refuses before moving when today's emails would pass ${PL_DAILY_EMAIL_CAP}`, async () => {
    setUp({ sentToday: PL_DAILY_EMAIL_CAP - 1 });
    const apps = [loaded(), loaded()];
    supabase.queue("applications", { data: apps, error: null });

    const result = await moveApplications(ctx(), {
      applicationIds: apps.map((a) => a.id),
      stageId: INTERVIEW.id,
      email: { templateId: ADVANCE.id },
    });

    expect(result).toEqual({
      ok: false,
      error: `You can send up to ${PL_DAILY_EMAIL_CAP} emails a day. 1 left today.`,
    });
    expect(updates()).toHaveLength(0);
    expect(sendCompanyMessage).not.toHaveBeenCalled();
    // Counted from today's email_sent events, since midnight IST.
    const [count] = supabase.callsFor("application_events");
    expect(count.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(count.chain).toContainEqual({ method: "eq", args: ["type", "email_sent"] });
    expect(count.chain).toContainEqual({ method: "gte", args: ["created_at", "2026-10-14T18:30:00.000Z"] });
  });

  it("logs email_sent events in the same single insert as the stage changes", async () => {
    setUp();
    const app = loaded();
    supabase.queue("applications", { data: [app], error: null });

    await moveApplications(ctx(), {
      applicationIds: [app.id],
      stageId: INTERVIEW.id,
      email: { templateId: ADVANCE.id },
    });

    expect(eventInserts()).toHaveLength(1);
    expect(insertedEvents()).toEqual([
      expect.objectContaining({ type: "stage_changed", application_id: app.id }),
      {
        company_id: COMPANY_A.id,
        application_id: app.id,
        candidate_user_id: app.applicant_user_id,
        actor_user_id: COMPANY_A.user.id,
        actor_name: expect.any(String),
        type: "email_sent",
        payload: { template_id: ADVANCE.id, subject: "Next steps for Founding Backend Engineer" },
      },
    ]);
    // Never the body.
    expect(JSON.stringify(insertedEvents())).not.toContain("Hi Ada");
  });

  it("still moves when a send fails, and reports it as email_failed", async () => {
    setUp();
    const apps = [loaded(), loaded()];
    supabase.queue("applications", { data: apps, error: null });
    vi.mocked(sendCompanyMessage)
      .mockResolvedValueOnce({ ok: false, error: "Failed to send email" })
      .mockResolvedValueOnce({ ok: true });

    const result = await moveApplications(ctx(), {
      applicationIds: apps.map((a) => a.id),
      stageId: INTERVIEW.id,
      email: { templateId: ADVANCE.id },
    });

    expect(result).toMatchObject({
      ok: true,
      moved: 2,
      emailed: 1,
      skipped: [{ id: apps[0].id, reason: "email_failed" }],
    });
    expect(insertedEvents().filter((e) => e.type === "email_sent")).toHaveLength(1);
  });

  it("reports an application without an email address as email_failed", async () => {
    setUp();
    const app = loaded(pipelineAppOf({ user_info: { full_name: "Ada Lovelace", email: null } }));
    supabase.queue("applications", { data: [app], error: null });

    const result = await moveApplications(ctx(), {
      applicationIds: [app.id],
      stageId: INTERVIEW.id,
      email: { templateId: ADVANCE.id },
    });

    expect(result).toMatchObject({
      ok: true,
      moved: 1,
      emailed: 0,
      skipped: [{ id: app.id, reason: "email_failed" }],
    });
    expect(sendCompanyMessage).not.toHaveBeenCalled();
  });
});

describe("actorName (TMT-060, teams difference 8)", () => {
  it("uses the member's display name first", () => {
    expect(actorName(MEMBER_A.user, MEMBER_A.myCompany)).toBe("Max Member");
  });

  it("falls back to the account name, then the email's local part", () => {
    const company = { ...MEMBER_A.myCompany, displayName: null };
    expect(actorName(mockUser({ email: "max@acme.dev", user_metadata: { full_name: "Max M" } }), company)).toBe("Max M");
    expect(actorName(mockUser({ email: "max.m@acme.dev" }), company)).toBe("max.m");
  });

  it("never uses the company name", () => {
    const company = { ...MEMBER_A.myCompany, displayName: null, name: "Acme" };
    expect(actorName(mockUser({ email: "" }), company)).toBeNull();
  });
});
