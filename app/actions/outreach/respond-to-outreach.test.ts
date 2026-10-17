import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail, sendEmailForStatusUpdate } from "@/utils/email";
import { PostHogEvent } from "@/utils/types";
import { flushAfter } from "@/test/utils/after";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { OUTREACH_JOB, outreachOf } from "@/test/utils/outreach";
import { respondToOutreachAction } from "./respond-to-outreach";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn(), sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

const SENT = outreachOf("sent");
const pgError = (message: string) => ({ message, code: "P0001", details: "", hint: "" });

let candidate: SupabaseMock;
let service: SupabaseMock;
const getUserById = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  candidate = createSupabaseMock({ user: PUBLIC_APPLICANT.user });
  service = createSupabaseMock();
  (service.client.auth as unknown as { admin: unknown }).admin = { getUserById };
  getUserById.mockResolvedValue({ data: { user: { id: COMPANY_A.user.id, email: "recruiter@acme.dev" } }, error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  await setRequestUser(PUBLIC_APPLICANT.user, candidate.client);
  // The sender is still on the team.
  service.queue("company_members", { data: { user_id: COMPANY_A.user.id }, error: null });
  service.queue("user_info", { data: { full_name: "Ada Lovelace" }, error: null });
  service.queue("job_postings", { data: { title: OUTREACH_JOB.title }, error: null });
});

function answer(row = outreachOf("interested", { id: SENT.id, candidate_note: "Next week works.", candidate_contact: "+91 98765 43210" })) {
  candidate.queueRpc("respond_to_outreach", { data: row, error: null });
  return row;
}

describe("respondToOutreachAction (ORT-024)", () => {
  it.each([
    ["status sent", { outreachId: SENT.id, status: "sent" }],
    ["status withdrawn", { outreachId: SENT.id, status: "withdrawn" }],
    ["an unknown reason", { outreachId: SENT.id, status: "not_interested", reason: "boring" }],
    ["a 501-char note", { outreachId: SENT.id, status: "interested", note: "n".repeat(501) }],
    ["a 121-char contact", { outreachId: SENT.id, status: "interested", contact: "c".repeat(121) }],
    ["a candidate id", { outreachId: SENT.id, status: "interested", candidateUserId: PUBLIC_APPLICANT.id }],
    ["a non-UUID id", { outreachId: "x", status: "interested" }],
  ])("rejects %s without calling the RPC", async (_, input) => {
    expect(await respondToOutreachAction(input as never)).toMatchObject({ ok: false });
    expect(candidate.callsFor("respond_to_outreach")).toHaveLength(0);
  });

  it("refuses a signed-out caller", async () => {
    await setRequestUser(null);
    expect(await respondToOutreachAction({ outreachId: SENT.id, status: "interested" })).toMatchObject({ ok: false });
  });

  it("calls respond_to_outreach with the session client", async () => {
    answer();

    const result = await respondToOutreachAction({
      outreachId: SENT.id,
      status: "interested",
      note: " Next week works. ",
      contact: "+91 98765 43210",
      block: false,
    });

    expect(result).toMatchObject({ ok: true });
    expect(candidate.callsFor("respond_to_outreach")[0].chain[0].args[1]).toEqual({
      p_id: SENT.id,
      p_status: "interested",
      p_reason: null,
      p_note: "Next week works.",
      p_contact: "+91 98765 43210",
      p_block: false,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/opportunities");
  });

  it("passes p_block when Block this company is ticked", async () => {
    answer(outreachOf("not_interested", { id: SENT.id, decline_reason: "company" }));

    await respondToOutreachAction({ outreachId: SENT.id, status: "not_interested", reason: "company", block: true });

    expect(candidate.callsFor("respond_to_outreach")[0].chain[0].args[1]).toMatchObject({
      p_status: "not_interested",
      p_reason: "company",
      p_block: true,
    });
  });

  it("maps a second answer to { ok: false }", async () => {
    candidate.queueRpc("respond_to_outreach", { data: null, error: pgError("ALREADY_ANSWERED") });

    expect(await respondToOutreachAction({ outreachId: SENT.id, status: "interested" })).toEqual({
      ok: false,
      error: "You've already answered this message.",
    });
    await flushAfter();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails the sender (address from sender_user_id, service role) after the response", async () => {
    answer();

    await respondToOutreachAction({ outreachId: SENT.id, status: "interested" });
    expect(sendEmail).not.toHaveBeenCalled();
    await flushAfter();

    expect(getUserById).toHaveBeenCalledWith(COMPANY_A.user.id);
    const mail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(mail.toEmail).toBe("recruiter@acme.dev");
    expect(mail.subject).toContain("Ada is interested");
    expect(mail.htmlContent).toContain("Next week works.");
    expect(mail.htmlContent).toContain(`/company/profiles/${PUBLIC_APPLICANT.id}`);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("sends a report to the admin and nothing to the company", async () => {
    answer(outreachOf("reported", { id: SENT.id, candidate_note: "Spam" }));

    await respondToOutreachAction({ outreachId: SENT.id, status: "reported", note: "Spam" });
    await flushAfter();

    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining(SENT.id));
    expect(sendEmail).not.toHaveBeenCalled();
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("captures outreach_replied without the note or the contact", async () => {
    answer();

    await respondToOutreachAction({ outreachId: SENT.id, status: "interested", note: "Next week works.", contact: "+91 98765 43210" });

    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.OutreachReplied,
      distinctId: PUBLIC_APPLICANT.id,
      properties: { status: "interested", has_reason: false, blocked: false },
    });
    expect(JSON.stringify(vi.mocked(eventCaptureServer).mock.calls)).not.toContain("Next week");
  });
});

describe("reply recipient after a member is removed (TMT-054, difference 7)", () => {
  it("sends the reply to the owner when the sender is no longer a member", async () => {
    const removed = "c3000000-0000-4000-8000-000000000001";
    service.reset();
    service.queue("company_members", { data: null, error: null });
    service.queue("company_info", { data: { user_id: COMPANY_A.user.id }, error: null });
    service.queue("user_info", { data: { full_name: "Ada Lovelace" }, error: null });
    service.queue("job_postings", { data: { title: OUTREACH_JOB.title }, error: null });
    answer(outreachOf("interested", { id: SENT.id, sender_user_id: removed, candidate_contact: "+91 98765 43210" }));

    await respondToOutreachAction({ outreachId: SENT.id, status: "interested" });
    await flushAfter();

    expect(service.callsFor("company_members")[0].chain).toContainEqual({ method: "eq", args: ["user_id", removed] });
    expect(getUserById).toHaveBeenCalledWith(COMPANY_A.user.id);
    expect(getUserById).not.toHaveBeenCalledWith(removed);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: "recruiter@acme.dev" }));
  });

  it("sends nothing when the company has no owner to fall back to", async () => {
    service.reset();
    service.queue("company_members", { data: null, error: null });
    service.queue("company_info", { data: null, error: null });
    answer();

    await respondToOutreachAction({ outreachId: SENT.id, status: "interested" });
    await flushAfter();

    expect(getUserById).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
