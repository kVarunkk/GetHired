import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_A } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { previewMove } from "./move";
import { previewAgentMove } from "./preview-agent-move";

vi.mock("server-only", () => ({}));
vi.mock("./move", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./move")>()),
  previewMove: vi.fn(),
}));

const APP = "e0000000-0000-4000-8000-000000000001";
const STAGE = "5a000000-0000-4000-8000-000000000001";
const session = () => ({ supabase: createSupabaseMock().client, company: OWNER_A.myCompany, user: COMPANY_A.user });

beforeEach(() => vi.mocked(previewMove).mockReset().mockResolvedValue({ ok: false, error: "x" }));

describe("previewAgentMove (IVT-071)", () => {
  it("passes the tool's cancelInterviews to the preview", async () => {
    await previewAgentMove(session(), { applicationIds: [APP], stageId: STAGE, cancelInterviews: false });
    expect(vi.mocked(previewMove).mock.calls[0][1]).toMatchObject({ cancelInterviews: false });
    await previewAgentMove(session(), { applicationIds: [APP], stageId: STAGE });
    expect(vi.mocked(previewMove).mock.calls[1][1].cancelInterviews).toBeUndefined();
  });
});
