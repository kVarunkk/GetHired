import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { archiveStage, createStage, renameStage, reorderStages } from "@/helpers/pipeline/stages";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { stageOf, templateOf } from "@/test/utils/pipeline";
import { PostHogEvent } from "@/utils/types";
import { saveStagesAction } from "./save-stages";
import { saveTemplateAction } from "./save-template";
import { createTemplateAction } from "./create-template";
import { deleteTemplateAction } from "./delete-template";
import { saveSchedulingLinkAction } from "./save-scheduling-link";
import { saveCompanyNotificationSettingsAction } from "./save-notification-settings";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/pipeline/stages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/pipeline/stages")>()),
  createStage: vi.fn(),
  renameStage: vi.fn(),
  archiveStage: vi.fn(),
  reorderStages: vi.fn(),
}));
vi.mock("server-only", () => ({}));

const INTERVIEW = stageOf("interview");
const REJECTION = templateOf("rejection");
let supabase: SupabaseMock;

async function signIn(user = COMPANY_A.user) {
  supabase = createSupabaseMock({ user });
  supabase.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(user, supabase.client);
}

const argsOf = (table: string, method: string) =>
  supabase
    .callsFor(table)
    .flatMap((c) => c.chain.filter((m) => m.method === method))
    .map((m) => m.args);

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
  vi.mocked(createStage).mockResolvedValue({ ok: true, stage: INTERVIEW });
  vi.mocked(renameStage).mockResolvedValue({ ok: true });
  vi.mocked(archiveStage).mockResolvedValue({ ok: true });
  vi.mocked(reorderStages).mockResolvedValue({ ok: true });
});

describe("saveStagesAction (PLT-064)", () => {
  it("routes each change to its helper with the session company", async () => {
    // Each call looks the company up again.
    for (let i = 0; i < 3; i++) supabase.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });

    await saveStagesAction({ op: "create", name: "Take-home", kind: "interview" });
    await saveStagesAction({ op: "rename", stageId: INTERVIEW.id, name: "Onsite" });
    await saveStagesAction({ op: "archive", stageId: INTERVIEW.id });
    await saveStagesAction({ op: "reorder", ids: [INTERVIEW.id] });

    expect(vi.mocked(createStage).mock.calls[0][0].company.id).toBe(COMPANY_A.id);
    expect(vi.mocked(createStage).mock.calls[0][1]).toEqual({ name: "Take-home", kind: "interview" });
    expect(vi.mocked(renameStage).mock.calls[0][1]).toEqual({ stageId: INTERVIEW.id, name: "Onsite" });
    expect(vi.mocked(archiveStage).mock.calls[0][1]).toEqual({ stageId: INTERVIEW.id });
    expect(vi.mocked(reorderStages).mock.calls[0][1]).toEqual([INTERVIEW.id]);
    expect(revalidatePath).toHaveBeenCalledWith("/company/settings");
  });

  it("passes a refusal through, with the application count", async () => {
    vi.mocked(archiveStage).mockResolvedValue({
      ok: false,
      error: "Move the 3 applications out of this stage first.",
      count: 3,
    });

    expect(await saveStagesAction({ op: "archive", stageId: INTERVIEW.id })).toEqual({
      ok: false,
      error: "Move the 3 applications out of this stage first.",
      count: 3,
    });
  });

  it.each([
    ["an unknown op", { op: "delete", stageId: INTERVIEW.id }],
    ["an unknown kind", { op: "create", name: "x", kind: "phone_screen" }],
    ["a company id", { op: "archive", stageId: INTERVIEW.id, companyId: COMPANY_A.id }],
  ])("rejects %s", async (_, input) => {
    expect(await saveStagesAction(input as never)).toMatchObject({ ok: false });
    expect(createStage).not.toHaveBeenCalled();
    expect(archiveStage).not.toHaveBeenCalled();
  });

  it("refuses a caller who isn't a company", async () => {
    await signIn(mockUser({ type: "applicant" }));

    expect(await saveStagesAction({ op: "archive", stageId: INTERVIEW.id })).toMatchObject({ ok: false });
    expect(archiveStage).not.toHaveBeenCalled();
  });
});

describe("saveTemplateAction (PLT-064)", () => {
  const input = {
    templateId: REJECTION.id,
    name: "Rejection",
    subject: "About {{job_title}}",
    body: "Hi {{candidate_first_name}}",
  };

  it("saves the company's template and captures pipeline_template_saved", async () => {
    supabase.queue("company_email_templates", { data: { id: REJECTION.id, purpose: "rejection" }, error: null });

    expect(await saveTemplateAction(input)).toEqual({ ok: true });
    expect(argsOf("company_email_templates", "update")[0][0]).toMatchObject({
      name: "Rejection",
      subject: "About {{job_title}}",
      body_md: "Hi {{candidate_first_name}}",
    });
    expect(argsOf("company_email_templates", "eq")).toContainEqual(["company_id", COMPANY_A.id]);
    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.PipelineTemplateSaved,
      distinctId: COMPANY_A.user.id,
      properties: { purpose: "rejection" },
    });
  });

  it("refuses unknown variables without saving", async () => {
    expect(await saveTemplateAction({ ...input, body: "Hi {{first_name}}" })).toEqual({
      ok: false,
      error: "Remove or fix {{first_name}}.",
      unknownVariables: ["first_name"],
    });
    expect(supabase.callsFor("company_email_templates")).toHaveLength(0);
  });

  it.each([
    ["a 151-char subject", { subject: "x".repeat(151) }],
    ["an empty body", { body: "  " }],
    ["a 61-char name", { name: "x".repeat(61) }],
  ])("rejects %s", async (_, change) => {
    expect(await saveTemplateAction({ ...input, ...change })).toMatchObject({ ok: false });
    expect(supabase.callsFor("company_email_templates")).toHaveLength(0);
  });

  it("reports another company's template as not found", async () => {
    supabase.queue("company_email_templates", { data: null, error: null });

    expect(await saveTemplateAction(input)).toEqual({ ok: false, error: "Template not found." });
    expect(eventCaptureServer).not.toHaveBeenCalled();
  });
});

describe("createTemplateAction", () => {
  const input = {
    purpose: "rejection" as const,
    name: "Rejection (senior)",
    subject: "About {{job_title}}",
    body: "Hi {{candidate_first_name}}",
  };
  const CREATED = templateOf("rejection", { id: "7e700000-0000-4000-8000-0000000000aa", is_default: false });

  it("adds a non-default template for the company and captures pipeline_template_saved", async () => {
    supabase.queue("company_email_templates", { data: null, error: null, count: 5 });
    supabase.queue("company_email_templates", { data: CREATED, error: null });

    expect(await createTemplateAction(input)).toEqual({ ok: true, template: CREATED });
    expect(argsOf("company_email_templates", "insert")[0][0]).toEqual({
      company_id: COMPANY_A.id,
      purpose: "rejection",
      name: "Rejection (senior)",
      subject: "About {{job_title}}",
      body_md: "Hi {{candidate_first_name}}",
      is_default: false,
    });
    expect(argsOf("company_email_templates", "eq")).toContainEqual(["company_id", COMPANY_A.id]);
    expect(revalidatePath).toHaveBeenCalledWith("/company/settings");
    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.PipelineTemplateSaved,
      distinctId: COMPANY_A.user.id,
      properties: { purpose: "rejection", created: true },
    });
  });

  it("refuses unknown variables and an unknown purpose without writing", async () => {
    expect(await createTemplateAction({ ...input, subject: "{{salary}}" })).toMatchObject({
      ok: false,
      unknownVariables: ["salary"],
    });
    expect(
      await createTemplateAction({ ...input, purpose: "hired" as unknown as "rejection" }),
    ).toMatchObject({ ok: false });
    expect(supabase.callsFor("company_email_templates")).toHaveLength(0);
  });

  it("refuses past the per-company limit without inserting", async () => {
    supabase.queue("company_email_templates", { data: null, error: null, count: 30 });

    expect(await createTemplateAction(input)).toMatchObject({ ok: false, error: expect.stringContaining("30") });
    expect(argsOf("company_email_templates", "insert")).toHaveLength(0);
  });
});

describe("deleteTemplateAction", () => {
  const CUSTOM = templateOf("custom", { is_default: false });

  it("deletes only the company's own non-default template", async () => {
    supabase.queue("company_email_templates", { data: { id: CUSTOM.id }, error: null });

    expect(await deleteTemplateAction({ templateId: CUSTOM.id })).toEqual({ ok: true });
    expect(argsOf("company_email_templates", "delete")).toHaveLength(1);
    expect(argsOf("company_email_templates", "eq")).toEqual([
      ["id", CUSTOM.id],
      ["company_id", COMPANY_A.id],
      ["is_default", false],
    ]);
  });

  it("reports a default or another company's template as not found", async () => {
    supabase.queue("company_email_templates", { data: null, error: null });

    expect(await deleteTemplateAction({ templateId: REJECTION.id })).toEqual({
      ok: false,
      error: "Template not found, or it's a default template.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a malformed id without querying", async () => {
    expect(await deleteTemplateAction({ templateId: "nope" })).toEqual({ ok: false, error: "Template not found." });
    expect(supabase.callsFor("company_email_templates")).toHaveLength(0);
  });
});

const settingsRpc = () => supabase.callsFor("update_company_settings").map((c) => c.chain[0].args[1]);

describe("saveSchedulingLinkAction (PLT-064)", () => {
  beforeEach(() => {
    supabase.queueRpc("update_company_settings", { data: { ok: true }, error: null });
  });

  it("saves an https link through the settings RPC", async () => {
    expect(await saveSchedulingLinkAction({ schedulingUrl: " https://cal.com/acme/intro " })).toEqual({ ok: true });

    expect(settingsRpc()).toEqual([{ p_settings: { scheduling_url: "https://cal.com/acme/intro" } }]);
    // company_info is owner-only (teams difference 3).
    expect(argsOf("company_info", "update")).toHaveLength(0);
  });

  it("clears the link with an empty value", async () => {
    await saveSchedulingLinkAction({ schedulingUrl: "" });

    expect(settingsRpc()).toEqual([{ p_settings: { scheduling_url: null } }]);
  });

  it.each(["http://cal.com/acme", "javascript:alert(1)", "https://cal.com/a b"])("rejects %s", async (url) => {
    expect(await saveSchedulingLinkAction({ schedulingUrl: url })).toEqual({
      ok: false,
      error: "Use a link that starts with https://.",
    });
    expect(settingsRpc()).toHaveLength(0);
  });

  it("reports a refusal from the RPC", async () => {
    supabase.reset();
    supabase.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
    supabase.queueRpc("update_company_settings", { data: { ok: false, reason: "forbidden" }, error: null });

    expect(await saveSchedulingLinkAction({ schedulingUrl: "" })).toEqual({
      ok: false,
      error: "Couldn't save the link. Please try again.",
    });
  });
});

describe("saveCompanyNotificationSettingsAction (PLT-072)", () => {
  beforeEach(() => {
    supabase.queueRpc("update_company_settings", { data: { ok: true }, error: null });
  });

  it("saves the session company's settings through the settings RPC", async () => {
    expect(
      await saveCompanyNotificationSettingsAction({ notifyNewApplicants: "instant", notifyWeeklyMatches: false }),
    ).toEqual({ ok: true });

    expect(settingsRpc()).toEqual([
      { p_settings: { notify_new_applicants: "instant", notify_weekly_matches: false } },
    ]);
    expect(argsOf("company_info", "update")).toHaveLength(0);
  });

  it.each([
    ["an unknown frequency", { notifyNewApplicants: "hourly", notifyWeeklyMatches: true }],
    ["the digest watermark", { notifyNewApplicants: "daily", notifyWeeklyMatches: true, lastApplicantDigestAt: null }],
  ])("rejects %s", async (_, input) => {
    expect(await saveCompanyNotificationSettingsAction(input as never)).toMatchObject({ ok: false });
    expect(settingsRpc()).toHaveLength(0);
  });
});

describe("roles (TM-REQ-004)", () => {
  async function signInAs(member: MemberFixture) {
    supabase = createSupabaseMock({ user: member.user });
    supabase.queueRpc("my_company_access", { data: member.membership, error: null });
    await setRequestUser(member.user, supabase.client);
  }

  // RP-REQ-002: each needs its own settings permission, which Member lacks.
  const REFUSED = { ok: false, error: expect.stringMatching(/^Your role can't (edit pipeline stages|edit email templates|change the scheduling link|change notification settings)\.$/) };

  it("refuses a member every stage, template and settings change, without writing", async () => {
    for (const run of [
      () => saveStagesAction({ op: "create", name: "Take-home", kind: "interview" }),
      () => saveTemplateAction({ templateId: REJECTION.id, name: "R", subject: "S", body: "B" }),
      () => createTemplateAction({ purpose: "custom", name: "R", subject: "S", body: "B" }),
      () => deleteTemplateAction({ templateId: REJECTION.id }),
      () => saveSchedulingLinkAction({ schedulingUrl: "" }),
      () => saveCompanyNotificationSettingsAction({ notifyNewApplicants: "off", notifyWeeklyMatches: false }),
    ]) {
      await signInAs(MEMBER_A);
      expect(await run()).toMatchObject(REFUSED);
      expect(supabase.calls.filter((c) => c.target !== "my_company_access")).toHaveLength(0);
    }
    expect(createStage).not.toHaveBeenCalled();
  });

  it("lets an admin change stages and settings", async () => {
    await signInAs(ADMIN_A);
    expect(await saveStagesAction({ op: "create", name: "Take-home", kind: "interview" })).toMatchObject({ ok: true });

    await signInAs(ADMIN_A);
    supabase.queueRpc("update_company_settings", { data: { ok: true }, error: null });
    expect(await saveSchedulingLinkAction({ schedulingUrl: "" })).toEqual({ ok: true });
  });
});
