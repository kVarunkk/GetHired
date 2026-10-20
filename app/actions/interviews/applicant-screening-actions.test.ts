import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { flushAfter } from "@/test/utils/after";
import { SCREENING_CONSENT_VERSION } from "@/helpers/interview/screening/schemas";
import { notifyCompanyOfCandidateResponse } from "@/helpers/interview/screening/notify-company";
import { recordScreeningConsentAction } from "./record-screening-consent";
import { declineScreeningInterviewAction } from "./decline-screening-interview";
import { requestScreeningAccommodationAction } from "./request-screening-accommodation";
import { getMyScreeningInterviewAction } from "./get-my-screening-interview";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/interview/screening/notify-company", () => ({ notifyCompanyOfCandidateResponse: vi.fn() }));

const AI = "fa000000-0000-4000-8000-000000000001";
const APPLICANT = mockUser({ type: "applicant", id: "a0000000-0000-4000-8000-000000000001" });
let rls: SupabaseMock;
let service: SupabaseMock;

async function signIn(user = APPLICANT) {
  rls = createSupabaseMock({ user });
  await setRequestUser(user, rls.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  await signIn();
});

describe("applicant screening actions (SI-REQ-016/020/026)", () => {
  it.each([
    ["consent", () => recordScreeningConsentAction({ id: AI })],
    ["decline", () => declineScreeningInterviewAction({ id: AI })],
    ["accommodation", () => requestScreeningAccommodationAction({ id: AI, text: "Hearing" })],
  ])("%s refuses a company user", async (_, run) => {
    await signIn(mockUser({ type: "company" }));
    expect(await run()).toEqual({ ok: false, error: "Only applicants can do this." });
    expect(rls.calls.filter((c) => c.kind === "rpc")).toHaveLength(0);
  });

  it("consent stores the current consent version", async () => {
    rls.queueRpc("record_screening_consent", { data: { ok: true }, error: null });
    expect(await recordScreeningConsentAction({ id: AI })).toEqual({ ok: true });
    expect(rls.callsFor("record_screening_consent")[0].chain[0].args[1]).toEqual({
      p_id: AI,
      p_version: SCREENING_CONSENT_VERSION,
    });
  });

  it("maps a wrong status to a message", async () => {
    rls.queueRpc("decline_screening_interview", { data: { ok: false, reason: "not_invited" }, error: null });
    expect(await declineScreeningInterviewAction({ id: AI })).toEqual({
      ok: false,
      error: "This interview isn't open any more.",
    });
    await flushAfter();
    expect(notifyCompanyOfCandidateResponse).not.toHaveBeenCalled();
  });

  it("decline tells the company after the response", async () => {
    rls.queueRpc("decline_screening_interview", { data: { ok: true }, error: null });
    expect(await declineScreeningInterviewAction({ id: AI })).toEqual({ ok: true });
    expect(notifyCompanyOfCandidateResponse).not.toHaveBeenCalled();
    await flushAfter();
    expect(notifyCompanyOfCandidateResponse).toHaveBeenCalledWith(service.client, AI, "declined");
    expect(revalidatePath).toHaveBeenCalledWith(`/interview/screening/${AI}`);
  });

  it("accommodation needs 1–500 characters", async () => {
    expect(await requestScreeningAccommodationAction({ id: AI, text: "x".repeat(501) })).toEqual({
      ok: false,
      error: "Write up to 500 characters.",
    });
    expect(await requestScreeningAccommodationAction({ id: AI, text: "   " })).toEqual({
      ok: false,
      error: "Write up to 500 characters.",
    });
    expect(rls.callsFor("request_screening_accommodation")).toHaveLength(0);
  });

  it("accommodation pauses the interview and tells the company", async () => {
    rls.queueRpc("request_screening_accommodation", { data: { ok: true }, error: null });
    expect(await requestScreeningAccommodationAction({ id: AI, text: " I have a hearing impairment. " })).toEqual({
      ok: true,
    });
    expect(rls.callsFor("request_screening_accommodation")[0].chain[0].args[1]).toEqual({
      p_id: AI,
      p_text: "I have a hearing impairment.",
    });
    await flushAfter();
    expect(notifyCompanyOfCandidateResponse).toHaveBeenCalledWith(service.client, AI, "accommodation");
  });
});

describe("getMyScreeningInterviewAction (SIT-053)", () => {
  it("reads the session applicant's own interview through my_screening_interviews", async () => {
    rls.queueRpc("my_screening_interviews", { data: { id: AI, status: "completed" }, error: null });
    expect(await getMyScreeningInterviewAction({ id: AI })).toEqual({ ok: true, interview: { id: AI, status: "completed" } });
    expect(rls.callsFor("my_screening_interviews")[0].chain).toContainEqual({ method: "eq", args: ["id", AI] });
  });

  it("returns not found for an interview that isn't theirs", async () => {
    expect(await getMyScreeningInterviewAction({ id: AI })).toEqual({ ok: false, error: "Interview not found." });
  });

  it("refuses a company user", async () => {
    await signIn(mockUser({ type: "company" }));
    expect(await getMyScreeningInterviewAction({ id: AI })).toEqual({ ok: false, error: "Only applicants can do this." });
  });
});
