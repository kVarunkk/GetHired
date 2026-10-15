import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewMove } from "@/helpers/pipeline/move";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { previewAgentMoveAction } from "./preview-agent-move";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/helpers/pipeline/move", () => ({ previewMove: vi.fn() }));

const APP = "e0000000-0000-4000-8000-000000000001";
const STAGE = "90000000-0000-4000-8000-000000000002";
const TEMPLATE = "d0000000-0000-4000-8000-000000000001";

async function signIn(user = COMPANY_A.user) {
  const supabase = createSupabaseMock({ user });
  supabase.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });
  await setRequestUser(user, supabase.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
});

describe("previewAgentMoveAction (RA-TASK-040)", () => {
  it("previews the tool's input for the session company", async () => {
    vi.mocked(previewMove).mockResolvedValue({ ok: false, error: "Stage not found." });

    const result = await previewAgentMoveAction({
      applicationIds: [APP],
      stageId: STAGE,
      email: { templateId: TEMPLATE, subject: "Next steps" },
    });

    const [ctx, input] = vi.mocked(previewMove).mock.calls[0];
    expect(ctx.company.id).toBe(COMPANY_A.id);
    expect(input).toEqual({
      applicationIds: [APP],
      stageId: STAGE,
      email: { templateId: TEMPLATE, overrides: { subject: "Next steps", body: undefined } },
    });
    expect(result).toEqual({ ok: false, error: "Stage not found." });
  });

  it("refuses input the tool wouldn't accept", async () => {
    for (const input of [null, { applicationIds: [], stageId: STAGE }, { applicationIds: ["x"], stageId: STAGE }]) {
      expect(await previewAgentMoveAction(input)).toMatchObject({ ok: false });
    }
    expect(previewMove).not.toHaveBeenCalled();
  });

  it("refuses a caller who isn't a company", async () => {
    await signIn(mockUser({ type: "applicant" }));

    expect(await previewAgentMoveAction({ applicationIds: [APP], stageId: STAGE })).toMatchObject({ ok: false });
    expect(previewMove).not.toHaveBeenCalled();
  });
});
