import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { moveApplications } from "@/helpers/pipeline/move";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { PIPELINE_JOB, pipelineAppOf, stageOf } from "@/test/utils/pipeline";
import { PostHogEvent } from "@/utils/types";
import { moveApplicationsAction } from "./move-applications";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/pipeline/move", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/pipeline/move")>()),
  moveApplications: vi.fn(),
}));

const INTERVIEW = stageOf("interview");
const APP = pipelineAppOf();

let supabase: SupabaseMock;

async function signIn(user = COMPANY_A.user) {
  supabase = createSupabaseMock({ user });
  supabase.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });
  await setRequestUser(user, supabase.client);
}

const moved = {
  ok: true as const,
  moved: 1,
  emailed: 0,
  skipped: [],
  stage: { id: INTERVIEW.id, name: INTERVIEW.name, kind: INTERVIEW.kind },
  movedIds: [APP.id],
  applications: [
    {
      id: APP.id,
      jobPostId: PIPELINE_JOB.id,
      candidateUserId: APP.applicant_user_id,
      fromStageId: stageOf("applied").id,
      fromKind: "applied" as const,
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      jobTitle: PIPELINE_JOB.title,
      companyName: COMPANY_A.info.name,
    },
  ],
};

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
  vi.mocked(moveApplications).mockResolvedValue(moved);
});

describe("moveApplicationsAction (PLT-031)", () => {
  it("refuses a caller who isn't a company", async () => {
    await signIn(mockUser({ type: "applicant" }));

    expect(
      await moveApplicationsAction({ applicationIds: [APP.id], stageId: INTERVIEW.id }),
    ).toMatchObject({ ok: false });
    expect(moveApplications).not.toHaveBeenCalled();
  });

  it.each([
    ["no ids", { applicationIds: [], stageId: INTERVIEW.id }],
    ["51 ids", { applicationIds: Array.from({ length: 51 }, () => pipelineAppOf().id), stageId: INTERVIEW.id }],
    ["a non-UUID id", { applicationIds: ["x"], stageId: INTERVIEW.id }],
    ["a non-UUID stage", { applicationIds: [APP.id], stageId: "x" }],
    ["a company id", { applicationIds: [APP.id], stageId: INTERVIEW.id, companyId: COMPANY_A.id }],
  ])("rejects %s", async (_, input) => {
    expect(await moveApplicationsAction(input as never)).toMatchObject({ ok: false });
    expect(moveApplications).not.toHaveBeenCalled();
  });

  it("moves with the session company and user, and revalidates the job page", async () => {
    expect(
      await moveApplicationsAction({ applicationIds: [APP.id], stageId: INTERVIEW.id }),
    ).toEqual({ ok: true, moved: 1, emailed: 0, skipped: [] });

    const [deps, params] = vi.mocked(moveApplications).mock.calls[0];
    expect(deps.company.id).toBe(COMPANY_A.id);
    expect(deps.user.id).toBe(COMPANY_A.user.id);
    expect(params).toEqual({ applicationIds: [APP.id], stageId: INTERVIEW.id });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${PIPELINE_JOB.id}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${PIPELINE_JOB.id}/applicants`);
  });

  it("passes an email choice through", async () => {
    const email = {
      templateId: "7e700000-0000-4000-8000-000000000001",
      overrides: { subject: "Hi", body: "Thanks" },
    };

    await moveApplicationsAction({ applicationIds: [APP.id], stageId: INTERVIEW.id, email });

    expect(vi.mocked(moveApplications).mock.calls[0][1]).toEqual({
      applicationIds: [APP.id],
      stageId: INTERVIEW.id,
      email,
    });
  });

  it.each([
    ["a non-UUID template", { templateId: "x" }],
    ["an extra email field", { templateId: "7e700000-0000-4000-8000-000000000001", to: "x@y.z" }],
  ])("rejects %s", async (_, email) => {
    expect(
      await moveApplicationsAction({ applicationIds: [APP.id], stageId: INTERVIEW.id, email } as never),
    ).toMatchObject({ ok: false });
    expect(moveApplications).not.toHaveBeenCalled();
  });

  it("passes the unknown variables of a refused render through", async () => {
    vi.mocked(moveApplications).mockResolvedValue({
      ok: false,
      error: "Remove or fix {{foo}} before sending.",
      unknownVariables: ["foo"],
    });

    expect(
      await moveApplicationsAction({
        applicationIds: [APP.id],
        stageId: INTERVIEW.id,
        email: { templateId: "7e700000-0000-4000-8000-000000000001" },
      }),
    ).toEqual({ ok: false, error: "Remove or fix {{foo}} before sending.", unknownVariables: ["foo"] });
  });

  it("captures pipeline_stage_moved", async () => {
    await moveApplicationsAction({ applicationIds: [APP.id], stageId: INTERVIEW.id });

    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.PipelineStageMoved,
      distinctId: COMPANY_A.user.id,
      properties: { count: 1, from_kind: "applied", to_kind: "interview", emailed: 0 },
    });
  });

  it("passes failures through without capturing", async () => {
    vi.mocked(moveApplications).mockResolvedValue({ ok: false, error: "Stage not found." });

    expect(
      await moveApplicationsAction({ applicationIds: [APP.id], stageId: INTERVIEW.id }),
    ).toEqual({ ok: false, error: "Stage not found." });
    expect(eventCaptureServer).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
