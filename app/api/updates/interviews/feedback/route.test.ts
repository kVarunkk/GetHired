import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { sendInterviewFeedbackEmails } from "@/helpers/interviews/feedback-emails";
import { GET, POST } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({ service: true })) }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret", deploymentUrl: () => "https://app.test" }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/interviews/feedback-emails", () => ({ sendInterviewFeedbackEmails: vi.fn() }));

const run = (handler = GET, secret: string | null = "test-secret") =>
  handler(
    buildRequest("/api/updates/interviews/feedback", {
      method: handler === POST ? "POST" : "GET",
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

beforeEach(() => vi.clearAllMocks());

describe("/api/updates/interviews/feedback (IVT-070)", () => {
  it("needs the internal secret", async () => {
    expect((await run(GET, null)).status).toBe(401);
    expect((await run(POST, "wrong")).status).toBe(401);
    expect(sendInterviewFeedbackEmails).not.toHaveBeenCalled();
  });

  it("sends with the service role and reports nothing when all went well", async () => {
    vi.mocked(sendInterviewFeedbackEmails).mockResolvedValue({ due: 3, sent: 2, skipped: 1, failures: [] });
    const res = await run(POST);
    expect(await res.json()).toEqual({ due: 3, sent: 2, skipped: 1, failures: 0 });
    expect(sendInterviewFeedbackEmails).toHaveBeenCalledWith({ service: true });
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("emails one summary of the failed sends, and reports a failed run", async () => {
    vi.mocked(sendInterviewFeedbackEmails).mockResolvedValue({ due: 2, sent: 0, skipped: 0, failures: ["a: x", "b: y"] });
    expect((await run()).status).toBe(200);
    expect(vi.mocked(sendEmailForStatusUpdate).mock.calls[0][0]).toContain("a: x\nb: y");

    vi.mocked(sendInterviewFeedbackEmails).mockRejectedValue(new Error("db down"));
    expect((await run()).status).toBe(500);
    expect(vi.mocked(sendEmailForStatusUpdate).mock.calls[1][0]).toContain("db down");
  });
});
