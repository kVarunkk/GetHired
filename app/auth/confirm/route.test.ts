import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildRequest } from "@/test/utils/request";
import { APPLICANT_HOME } from "@/helpers/user/home-path";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/utils/auth-handlers", () => ({ grantReferralCredits: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const verifyOtp = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({
    data: { user: { id: "u1", email: "priya@gmail.com", app_metadata: { type: "company" } } },
    error: null,
  });
  vi.mocked(createClient).mockResolvedValue({ auth: { verifyOtp } } as never);
});

async function confirm(next: string) {
  const url = `/auth/confirm?token_hash=h&type=signup&next=${encodeURIComponent(next)}`;
  await expect(GET(buildRequest(url))).rejects.toThrow(/REDIRECT:/);
  return vi.mocked(redirect).mock.calls[0][0];
}

describe("GET /auth/confirm", () => {
  it("keeps the next path's query, so an invite token survives (recruiter teams)", async () => {
    expect(await confirm("/company/join?token=tok_abc-123")).toBe("/company/join?token=tok_abc-123");
  });

  it("drops the referral code from the query", async () => {
    expect(await confirm("/get-started?company=true&ref=R1")).toBe("/get-started?company=true");
  });

  it("never redirects off-site", async () => {
    expect(await confirm("https://evil.example/x")).toBe(APPLICANT_HOME);
    vi.mocked(redirect).mockClear();
    expect(await confirm("//evil.example/x")).toBe(APPLICANT_HOME);
  });
});
