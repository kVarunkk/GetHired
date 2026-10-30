import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { hasPrefill, loadClaimPrefill } from "@/helpers/candidates/claim-prefill";
import { claimCandidateAction } from "./claim-candidate";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));
vi.mock("@/helpers/candidates/claim-prefill", () => ({ loadClaimPrefill: vi.fn(), hasPrefill: vi.fn() }));

const TOKEN = "t".repeat(43);
let db: SupabaseMock;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: mockUser() });
  await setRequestUser(mockUser(), db.client);
  vi.mocked(loadClaimPrefill).mockResolvedValue(null);
  vi.mocked(hasPrefill).mockReturnValue(false);
});

describe("claimCandidateAction (BIT-064, BI-REQ-041)", () => {
  it("claims as the session user and returns the interview page", async () => {
    db.queueRpc("claim_company_candidate", { data: { ok: true, application_interview_id: "ai1" }, error: null });

    expect(await claimCandidateAction({ token: TOKEN })).toEqual({
      ok: true,
      href: "/interview/screening/ai1",
      offerPrefill: false,
    });
    expect(db.callsFor("claim_company_candidate")[0].chain[0]).toEqual({ method: "rpc", args: ["claim_company_candidate", { p_token: TOKEN }] });
  });

  it("sends them to their applications when there's no open interview to land on", async () => {
    db.queueRpc("claim_company_candidate", { data: { ok: true, application_interview_id: null }, error: null });

    expect(await claimCandidateAction({ token: TOKEN })).toEqual({ ok: true, href: "/dashboard", offerPrefill: false });
  });

  it("shows the function's reason", async () => {
    db.queueRpc("claim_company_candidate", { data: { ok: false, reason: "expired" }, error: null });

    expect(await claimCandidateAction({ token: TOKEN })).toEqual({
      ok: false,
      error: "This link has expired. Ask the company to invite you again.",
    });
  });

  it("refuses without a session or with a company account, without calling the function", async () => {
    await setRequestUser(null);
    expect(await claimCandidateAction({ token: TOKEN })).toMatchObject({ ok: false, error: "Sign in or create an account first." });
    await setRequestUser(mockUser({ type: "company" }));
    expect(await claimCandidateAction({ token: TOKEN })).toMatchObject({ ok: false, error: expect.stringMatching(/company account/) });
    expect(db.callsFor("claim_company_candidate")).toHaveLength(0);
  });

  it("refuses a malformed token", async () => {
    expect(await claimCandidateAction({ token: "x" })).toMatchObject({ ok: false });
    expect(db.callsFor("claim_company_candidate")).toHaveLength(0);
  });

  it("throws on a database error", async () => {
    db.queueRpc("claim_company_candidate", { data: null, error: { message: "boom" } });
    await expect(claimCandidateAction({ token: TOKEN })).rejects.toThrow(/boom/);
  });

  describe("the profile prefill offer (BIT-105)", () => {
    const claimed = () =>
      db.queueRpc("claim_company_candidate", { data: { ok: true, application_interview_id: "ai1" }, error: null });

    it("is offered when the account hasn't set up a profile and the record has something", async () => {
      claimed();
      db.queue("user_info", { data: { filled: false }, error: null });
      vi.mocked(hasPrefill).mockReturnValue(true);

      expect(await claimCandidateAction({ token: TOKEN })).toMatchObject({ ok: true, offerPrefill: true });
      expect(loadClaimPrefill).toHaveBeenCalledWith(expect.anything(), TOKEN, mockUser().id);
      expect(db.callsFor("user_info")[0].chain).toContainEqual({ method: "eq", args: ["user_id", mockUser().id] });
    });

    it("isn't offered to an account with a profile, which is never touched", async () => {
      claimed();
      db.queue("user_info", { data: { filled: true }, error: null });

      expect(await claimCandidateAction({ token: TOKEN })).toMatchObject({ ok: true, offerPrefill: false });
      expect(loadClaimPrefill).not.toHaveBeenCalled();
      expect(db.callsFor("user_info").every((call) => call.chain.some((c) => c.method === "select"))).toBe(true);
    });

    it("never fails the claim when the offer can't be worked out", async () => {
      claimed();
      db.queue("user_info", { data: { filled: false }, error: null });
      vi.mocked(loadClaimPrefill).mockRejectedValue(new Error("down"));

      expect(await claimCandidateAction({ token: TOKEN })).toEqual({
        ok: true,
        href: "/interview/screening/ai1",
        offerPrefill: false,
      });
    });
  });
});
