import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeEntitlement,
  holdEntitlement,
  releaseHold,
} from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { PostHogEvent } from "@/utils/types";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { OUTREACH_INPUT, OUTREACH_JOB, outreachOf } from "@/test/utils/outreach";
import { sendOutreach } from "./send";
import { HIRING_MANAGER_A, JOB_A1, OWNER_A } from "@/test/utils/team";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/billing/entitlements", () => ({
  holdEntitlement: vi.fn(),
  consumeEntitlement: vi.fn(),
  releaseHold: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

const ROW = outreachOf("sent");

let user: SupabaseMock;
let service: SupabaseMock;

const deps = () => ({
  supabase: user.client,
  company: { ...OWNER_A.myCompany, name: "Acme" },
  user: COMPANY_A.user,
});

const pgError = (message: string) => ({ message, code: "P0001", details: "", hint: "" });

const entitlementError = () =>
  new EntitlementError({
    key: "outreach",
    kind: "allowance",
    qty: 1,
    used: 10,
    amount: 10,
    overageCredits: null,
    creditBalance: 0,
    creditsNeeded: 0,
    reason: "limit_reached",
    suggestedTier: { slug: "startup", name: "Startup" },
  });

function queueServiceLoads() {
  service.queue("user_info", { data: { email: PUBLIC_APPLICANT.info.email }, error: null });
  service.queue("company_info", { data: { name: "Acme", logo_url: null }, error: null });
  service.queue("job_postings", { data: { title: OUTREACH_JOB.title }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  user = createSupabaseMock({ user: COMPANY_A.user });
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  vi.mocked(holdEntitlement).mockResolvedValue(undefined);
  vi.mocked(consumeEntitlement).mockResolvedValue({ source: "allowance", creditsSpent: 0, duplicate: false });
  vi.mocked(releaseHold).mockResolvedValue(true);
  vi.mocked(sendEmail).mockResolvedValue(undefined);
  user.queueRpc("send_candidate_outreach", { data: ROW, error: null });
  queueServiceLoads();
});

describe("sendOutreach (ORT-021)", () => {
  it.each([
    ["a 121-char subject", { ...OUTREACH_INPUT, subject: "s".repeat(121) }],
    ["a 2,001-char message", { ...OUTREACH_INPUT, message: "m".repeat(2001) }],
    ["an empty message", { ...OUTREACH_INPUT, message: "   " }],
    ["a non-UUID candidate", { ...OUTREACH_INPUT, candidateId: "ada" }],
    ["a source in the input", { ...OUTREACH_INPUT, source: "agent" }],
    ["a company id in the input", { ...OUTREACH_INPUT, companyId: COMPANY_A.id }],
  ])("rejects %s without holding or calling the RPC", async (_, input) => {
    const result = await sendOutreach(deps(), input, { source: "manual" });

    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(holdEntitlement).not.toHaveBeenCalled();
    expect(user.callsFor("send_candidate_outreach")).toHaveLength(0);
  });

  it("holds, sends with the same id, consumes with the same ref, then emails", async () => {
    const result = await sendOutreach(deps(), OUTREACH_INPUT, { source: "manual" });

    expect(result).toEqual({ ok: true, outreach: ROW, emailed: true });

    const [companyId, key, qty, ref] = vi.mocked(holdEntitlement).mock.calls[0];
    expect([companyId, key, qty]).toEqual([COMPANY_A.id, "outreach", 1]);
    expect(ref.type).toBe("outreach");

    const rpc = user.callsFor("send_candidate_outreach")[0].chain[0].args[1];
    expect(rpc).toEqual({
      p_id: ref.id,
      p_candidate: OUTREACH_INPUT.candidateId,
      p_job_post: OUTREACH_INPUT.jobPostId,
      p_subject: OUTREACH_INPUT.subject,
      p_message: OUTREACH_INPUT.message,
      p_source: "manual",
    });

    expect(consumeEntitlement).toHaveBeenCalledWith(COMPANY_A.id, "outreach", 1, ref, COMPANY_A.user.id);
    expect(releaseHold).not.toHaveBeenCalled();

    const holdOrder = vi.mocked(holdEntitlement).mock.invocationCallOrder[0];
    const consumeOrder = vi.mocked(consumeEntitlement).mock.invocationCallOrder[0];
    const emailOrder = vi.mocked(sendEmail).mock.invocationCallOrder[0];
    expect(holdOrder).toBeLessThan(consumeOrder);
    expect(consumeOrder).toBeLessThan(emailOrder);
  });

  it("sends a null job when there's none", async () => {
    await sendOutreach(deps(), { ...OUTREACH_INPUT, jobPostId: null }, { source: "manual" });
    expect(user.callsFor("send_candidate_outreach")[0].chain[0].args[1]).toMatchObject({ p_job_post: null });
  });

  it("returns the entitlement error and calls neither the RPC nor the email when the hold fails", async () => {
    vi.mocked(holdEntitlement).mockRejectedValue(entitlementError());

    const result = await sendOutreach(deps(), OUTREACH_INPUT, { source: "manual" });

    expect(result).toMatchObject({ ok: false, error: { code: "entitlement", key: "outreach" } });
    expect(user.callsFor("send_candidate_outreach")).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(consumeEntitlement).not.toHaveBeenCalled();
  });

  it.each([
    ["ALREADY_OPEN", 409],
    ["NOT_ACCEPTING", 403],
    ["CANDIDATE_LIMIT", 429],
    ["NOT_FOUND", 404],
    ["JOB_NOT_FOUND", 404],
  ] as const)("releases the hold and sends nothing on %s", async (code, status) => {
    user.reset();
    user.queueRpc("send_candidate_outreach", { data: null, error: pgError(code) });

    const result = await sendOutreach(deps(), OUTREACH_INPUT, { source: "manual" });

    expect(result).toMatchObject({ ok: false, code, status });
    const ref = vi.mocked(holdEntitlement).mock.calls[0][3];
    expect(releaseHold).toHaveBeenCalledWith(COMPANY_A.id, "outreach", ref);
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(eventCaptureServer).not.toHaveBeenCalled();
  });

  it("emails the address from user_info (service role) with the company, job and respond link", async () => {
    await sendOutreach(deps(), OUTREACH_INPUT, { source: "manual" });

    expect(service.callsFor("user_info")[0].chain).toContainEqual({
      method: "eq",
      args: ["user_id", ROW.candidate_user_id],
    });
    const mail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(mail.toEmail).toBe(PUBLIC_APPLICANT.info.email);
    expect(mail.subject).toBe(`Acme: ${ROW.subject}`);
    expect(mail.senderName).toBe("Acme via GetHired");
    expect(mail.htmlContent).toContain("Message from Acme");
    expect(mail.htmlContent).toContain(`About: ${OUTREACH_JOB.title}`);
    expect(mail.htmlContent).toContain(`/opportunities/${ROW.id}`);
  });

  it("still consumes and returns ok with emailed: false when the email fails", async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error("smtp down"));

    const result = await sendOutreach(deps(), OUTREACH_INPUT, { source: "manual" });

    expect(result).toEqual({ ok: true, outreach: ROW, emailed: false });
    expect(consumeEntitlement).toHaveBeenCalled();
  });

  it.each(["manual", "agent"] as const)("passes source %s from the caller and captures outreach_sent", async (source) => {
    await sendOutreach(deps(), OUTREACH_INPUT, { source });

    expect(user.callsFor("send_candidate_outreach")[0].chain[0].args[1]).toMatchObject({ p_source: source });
    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.OutreachSent,
      distinctId: COMPANY_A.user.id,
      properties: { has_job: true, source },
    });
  });

  describe("job scope (RPT-053)", () => {
    const hiringManager = () => ({ ...deps(), company: HIRING_MANAGER_A.myCompany });

    it.each([
      ["a job they aren't assigned to", OUTREACH_INPUT.jobPostId],
      ["no job (needs all jobs)", null],
    ])("refuses %s before holding a unit", async (_, jobPostId) => {
      const result = await sendOutreach(hiringManager(), { ...OUTREACH_INPUT, jobPostId }, { source: "manual" });

      expect(result).toEqual({
        ok: false,
        code: "FORBIDDEN",
        status: 403,
        error: "Your role can't send outreach for this job.",
      });
      expect(holdEntitlement).not.toHaveBeenCalled();
      expect(user.callsFor("send_candidate_outreach")).toHaveLength(0);
    });

    it("sends for an assigned job", async () => {
      const result = await sendOutreach(hiringManager(), { ...OUTREACH_INPUT, jobPostId: JOB_A1 }, { source: "manual" });
      expect(result).toMatchObject({ ok: true });
    });
  });
});
