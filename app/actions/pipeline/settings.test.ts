import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { archiveStage, createStage, renameStage, reorderStages } from "@/helpers/pipeline/stages";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { stageOf, templateOf } from "@/test/utils/pipeline";
import { PostHogEvent } from "@/utils/types";
import { saveStagesAction } from "./save-stages";
import { saveTemplateAction } from "./save-template";
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
  supabase.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });
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
    for (let i = 0; i < 3; i++) supabase.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });

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

describe("saveSchedulingLinkAction (PLT-064)", () => {
  it("saves an https link on the session company", async () => {
    expect(await saveSchedulingLinkAction({ schedulingUrl: " https://cal.com/acme/intro " })).toEqual({ ok: true });

    expect(argsOf("company_info", "update")[0][0]).toEqual({ scheduling_url: "https://cal.com/acme/intro" });
    expect(argsOf("company_info", "eq")).toContainEqual(["id", COMPANY_A.id]);
  });

  it("clears the link with an empty value", async () => {
    await saveSchedulingLinkAction({ schedulingUrl: "" });

    expect(argsOf("company_info", "update")[0][0]).toEqual({ scheduling_url: null });
  });

  it.each(["http://cal.com/acme", "javascript:alert(1)", "https://cal.com/a b"])("rejects %s", async (url) => {
    expect(await saveSchedulingLinkAction({ schedulingUrl: url })).toEqual({
      ok: false,
      error: "Use a link that starts with https://.",
    });
    expect(argsOf("company_info", "update")).toHaveLength(0);
  });
});

describe("saveCompanyNotificationSettingsAction (PLT-072)", () => {
  it("saves the session company's settings", async () => {
    expect(
      await saveCompanyNotificationSettingsAction({ notifyNewApplicants: "instant", notifyWeeklyMatches: false }),
    ).toEqual({ ok: true });

    expect(argsOf("company_info", "update")[0][0]).toEqual({
      notify_new_applicants: "instant",
      notify_weekly_matches: false,
    });
    expect(argsOf("company_info", "eq")).toContainEqual(["id", COMPANY_A.id]);
  });

  it.each([
    ["an unknown frequency", { notifyNewApplicants: "hourly", notifyWeeklyMatches: true }],
    ["the digest watermark", { notifyNewApplicants: "daily", notifyWeeklyMatches: true, lastApplicantDigestAt: null }],
  ])("rejects %s", async (_, input) => {
    expect(await saveCompanyNotificationSettingsAction(input as never)).toMatchObject({ ok: false });
    expect(argsOf("company_info", "update")).toHaveLength(0);
  });
});
