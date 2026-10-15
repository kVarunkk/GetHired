import { readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { sendApplicationStatusEmail } from "@/helpers/email/send-application-status-email";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import {
  applicationOf,
  COMPANY_A,
  jobPostingOf,
  PRIVATE_APPLIED_TO_A,
} from "@/test/utils/recruiter";
import { DEFAULT_STAGES, stageOf } from "@/test/utils/pipeline";
import type { RecordedCall } from "@/test/utils/supabase-mock";
import { updateApplicationStatusAction } from "./update-application-status";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/email/send-application-status-email", () => ({
  sendApplicationStatusEmail: vi.fn(),
}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const POSTING = jobPostingOf(COMPANY_A, { title: "Staff Engineer" });
const APPLICATION = applicationOf(PRIVATE_APPLIED_TO_A, POSTING);

/** What the load query returns for COMPANY_A's application (in Applied). */
const LOADED = {
  id: APPLICATION.id,
  applicant_user_id: PRIVATE_APPLIED_TO_A.id,
  stage_id: stageOf("applied").id,
  pipeline_stages: { kind: "applied" },
  user_info: { email: PRIVATE_APPLIED_TO_A.info.email, full_name: PRIVATE_APPLIED_TO_A.info.full_name },
  job_postings: {
    id: POSTING.id,
    company_id: COMPANY_A.id,
    title: POSTING.title,
    company_info: { name: COMPANY_A.info.name },
  },
};

let supabase: SupabaseMock;

const updates = () =>
  supabase.callsFor("applications").filter((c) => c.chain.some((m) => m.method === "update"));

/** COMPANY_A's stages: the list, or the one stage the move looks up by id. */
const stages = (call: RecordedCall) => {
  const id = call.chain.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1];
  return id
    ? { data: DEFAULT_STAGES.find((s) => s.id === id) ?? null, error: null }
    : { data: DEFAULT_STAGES, error: null };
};

async function signIn(user = COMPANY_A.user) {
  supabase = createSupabaseMock({ user });
  supabase.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });
  supabase.queue("pipeline_stages", stages);
  supabase.queue("pipeline_stages", stages);
  await setRequestUser(user, supabase.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
  vi.mocked(sendApplicationStatusEmail).mockResolvedValue({ ok: true });
});

describe("updateApplicationStatusAction (RS-TEST-002)", () => {
  it("refuses an unauthenticated caller without touching the database", async () => {
    await setRequestUser(null, supabase.client);

    expect(
      await updateApplicationStatusAction({ applicationId: APPLICATION.id, status: "reviewed" }),
    ).toMatchObject({ ok: false });
    expect(supabase.calls).toHaveLength(0);
  });

  it("refuses an applicant", async () => {
    await signIn(mockUser({ type: "applicant" }));

    expect(
      await updateApplicationStatusAction({ applicationId: APPLICATION.id, status: "reviewed" }),
    ).toMatchObject({ ok: false });
    expect(supabase.callsFor("applications")).toHaveLength(0);
  });

  it.each([
    ["an unknown status", { applicationId: APPLICATION.id, status: "hired" }],
    ["a non-UUID id", { applicationId: "1; drop table", status: "reviewed" }],
  ])("rejects %s", async (_, input) => {
    expect(await updateApplicationStatusAction(input as never)).toMatchObject({ ok: false });
    expect(supabase.callsFor("applications")).toHaveLength(0);
  });

  it("treats another company's application as not found: no update, no email", async () => {
    supabase.queue("applications", { data: null, error: null });

    expect(
      await updateApplicationStatusAction({ applicationId: APPLICATION.id, status: "reviewed" }),
    ).toEqual({ ok: false, error: "Application not found." });
    await flushAfter();

    expect(updates()).toHaveLength(0);
    expect(sendApplicationStatusEmail).not.toHaveBeenCalled();
  });

  it("loads the application scoped to the session company's postings", async () => {
    supabase.queue("applications", { data: [LOADED], error: null });

    await updateApplicationStatusAction({ applicationId: APPLICATION.id, status: "reviewed" });

    const [load] = supabase.callsFor("applications");
    const select = String(load.chain.find((c) => c.method === "select")?.args[0]);
    expect(select.replace(/\s+/g, "")).toContain(
      "job_postings!inner(id,company_id,title,company_info(name))",
    );
    expect(load.chain).toContainEqual({ method: "in", args: ["id", [APPLICATION.id]] });
    expect(load.chain).toContainEqual({
      method: "eq",
      args: ["job_postings.company_id", COMPANY_A.id],
    });
  });

  it("moves to the stage that shows the status and emails the address stored in the database", async () => {
    supabase.queue("applications", { data: [LOADED], error: null });

    expect(
      await updateApplicationStatusAction({ applicationId: APPLICATION.id, status: "selected" }),
    ).toEqual({ ok: true, status: "selected" });
    await flushAfter();

    const [update] = updates();
    expect(update.chain).toContainEqual({ method: "in", args: ["id", [APPLICATION.id]] });
    // The sync trigger sets status = selected from the Hired stage.
    expect(update.chain.find((c) => c.method === "update")?.args[0]).toMatchObject({
      stage_id: stageOf("hired").id,
    });
    expect(sendApplicationStatusEmail).toHaveBeenCalledWith({
      toEmail: PRIVATE_APPLIED_TO_A.info.email,
      jobTitle: "Staff Engineer",
      companyName: COMPANY_A.info.name,
      status: "selected",
    });
  });

  it("leaves an application in a stage that already shows the status (Interview → reviewed)", async () => {
    supabase.queue("applications", {
      data: [{ ...LOADED, stage_id: stageOf("interview").id, pipeline_stages: { kind: "interview" } }],
      error: null,
    });

    expect(
      await updateApplicationStatusAction({ applicationId: APPLICATION.id, status: "reviewed" }),
    ).toEqual({ ok: true, status: "reviewed" });
    await flushAfter();

    expect(updates()).toHaveLength(0);
    expect(sendApplicationStatusEmail).toHaveBeenCalledTimes(1);
  });

  it("doesn't email with notify: false", async () => {
    supabase.queue("applications", { data: [LOADED], error: null });

    expect(
      await updateApplicationStatusAction({
        applicationId: APPLICATION.id,
        status: "rejected",
        notify: false,
      }),
    ).toEqual({ ok: true, status: "rejected" });
    await flushAfter();

    expect(updates()).toHaveLength(1);
    expect(sendApplicationStatusEmail).not.toHaveBeenCalled();
  });

  it("returns { ok: false } and sends nothing when the update fails", async () => {
    supabase.queue("applications", { data: [LOADED], error: null });
    supabase.queue("applications", { data: null, error: { message: "denied" } });

    expect(
      await updateApplicationStatusAction({ applicationId: APPLICATION.id, status: "reviewed" }),
    ).toMatchObject({ ok: false });
    await flushAfter();

    expect(sendApplicationStatusEmail).not.toHaveBeenCalled();
  });

  it("keeps the saved status when the email fails, and reports it", async () => {
    supabase.queue("applications", { data: [LOADED], error: null });
    vi.mocked(sendApplicationStatusEmail).mockResolvedValue({ ok: false, error: "down" });

    expect(
      await updateApplicationStatusAction({ applicationId: APPLICATION.id, status: "reviewed" }),
    ).toEqual({ ok: true, status: "reviewed" });
    await flushAfter();

    expect(eventCaptureServerException).toHaveBeenCalled();
  });
});

describe("app/actions/send-email", () => {
  it("is gone, so sendStatusUpdateEmail is no longer an exported action", () => {
    const actions = readdirSync(join(process.cwd(), "app/actions"));
    expect(actions.filter((f) => f.startsWith("send-email."))).toEqual([]);
  });
});
