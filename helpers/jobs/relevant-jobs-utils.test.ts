import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail, sendEmailForStatusUpdate } from "@/utils/email";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { processUserRelevance } from "./relevant-jobs-utils";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn(), sendEmailForStatusUpdate: vi.fn() }));
vi.mock("react-email", () => ({ render: vi.fn(async () => "<html/>") }));
vi.mock("@/emails/RelevantJobsSetupUpdateEmail", () => ({ default: () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const USER_ID = "c1000000-0000-4000-8000-000000000001";
const fetchMock = vi.fn();
let supabase: SupabaseMock;

const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const statusWrites = () => supabase.callsFor("user_info").filter((c) => has(c, "update"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  supabase = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase.client);
  supabase.queue("user_info", {
    data: { email: "a@example.com", full_name: "A", ai_credits: 100 },
    error: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("processUserRelevance", () => {
  it("returns the failure without writing failed or emailing the admin: the worker owns both (SM-REQ-013)", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));

    const result = await processUserRelevance(USER_ID, true);

    expect(result).toMatchObject({ success: false, error: expect.stringContaining("500") });
    expect(statusWrites()).toHaveLength(0);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rebuilds the feed and moves the status to completed through a guarded write", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "j1" }] }), { status: 200 }));
    supabase.queue("user_info", { data: [{ user_id: USER_ID }], error: null });

    const result = await processUserRelevance(USER_ID, true);

    expect(result).toEqual({ success: true });
    const [write] = statusWrites();
    expect(write.chain.find((m) => m.method === "update")!.args[0]).toMatchObject({
      relevant_jobs_update_status: "completed",
    });
    expect(write.chain).toContainEqual({ method: "in", args: ["user_id", [USER_ID]] });
    expect(write.chain.some((m) => m.method === "in" && m.args[0] === "relevant_jobs_update_status")).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: "a@example.com" }));
  });
});
