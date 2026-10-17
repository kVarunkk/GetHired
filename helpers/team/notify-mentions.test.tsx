import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { mentionToken } from "./mentions";
import { MENTION_EXCERPT_MAX, mentionExcerpt, sendNoteMentionEmails } from "./notify-mentions";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));

const PRIYA = "a1000000-0000-4000-8000-000000000002";
const SAM = "a1000000-0000-4000-8000-000000000003";
const APP_ID = "e0000000-0000-4000-8000-000000000001";
const NOTE = {
  id: "70e00000-0000-4000-8000-0000000000aa",
  body: `${mentionToken({ userId: PRIYA, name: "Priya Shah" })} can you check the system design answer?`,
  application_id: APP_ID,
  candidate_user_id: PUBLIC_APPLICANT.id,
};

let service: SupabaseMock;
const getUserById = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  service = createSupabaseMock();
  (service.client.auth as unknown as { admin: unknown }).admin = { getUserById };
  getUserById.mockImplementation(async (id: string) => ({
    data: { user: { id, email: id === PRIYA ? "priya@acme.dev" : "sam@gmail.com" } },
    error: null,
  }));
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
});

function queueContext() {
  service.queue("user_info", { data: { full_name: "Ravi Kumar" }, error: null });
  service.queue("applications", { data: { job_postings: { title: "Backend Engineer" } }, error: null });
}

describe("sendNoteMentionEmails (TMT-071)", () => {
  it("emails each teammate the claim RPC returns, once, with the first name, job and link", async () => {
    service.queueRpc("claim_note_mention_emails", { data: [PRIYA], error: null });
    queueContext();

    await sendNoteMentionEmails({ note: NOTE, authorName: "Asha Rao", userIds: [PRIYA, SAM] });

    expect(service.callsFor("claim_note_mention_emails")[0].chain[0].args).toEqual([
      "claim_note_mention_emails",
      { p_note_id: NOTE.id, p_user_ids: [PRIYA, SAM] },
    ]);
    // SAM wasn't claimed (not a member, already emailed or over the cap).
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(mail.toEmail).toBe("priya@acme.dev");
    expect(mail.subject).toBe("Asha Rao mentioned you in a note on Ravi");
    expect(mail.htmlContent).toContain(`/company/applicants/${APP_ID}`);
    expect(mail.textContent).toContain("Backend Engineer");
    // The token is shown as @name; the id never reaches the email.
    expect(mail.textContent).toContain("@Priya Shah can you check");
    expect(mail.htmlContent).not.toContain(PRIYA);
    expect(mail.textContent).not.toContain("Kumar");
  });

  it("links a talent-pool note to the candidate's profile", async () => {
    service.queueRpc("claim_note_mention_emails", { data: [PRIYA], error: null });
    service.queue("user_info", { data: { full_name: "Ravi Kumar" }, error: null });

    await sendNoteMentionEmails({
      note: { ...NOTE, application_id: null },
      authorName: "Asha Rao",
      userIds: [PRIYA],
    });

    const mail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(mail.htmlContent).toContain(`/company/profiles/${PUBLIC_APPLICANT.id}`);
    expect(service.callsFor("applications")).toHaveLength(0);
  });

  it("sends nothing when nobody is claimed, and doesn't call the RPC for no mentions", async () => {
    service.queueRpc("claim_note_mention_emails", { data: [], error: null });
    await sendNoteMentionEmails({ note: NOTE, authorName: "Asha Rao", userIds: [SAM] });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(service.callsFor("user_info")).toHaveLength(0);

    await sendNoteMentionEmails({ note: NOTE, authorName: "Asha Rao", userIds: [] });
    expect(service.callsFor("claim_note_mention_emails")).toHaveLength(1);
  });

  it("logs instead of throwing when the RPC or a send fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    service.queueRpc("claim_note_mention_emails", { data: null, error: { message: "boom" } });
    await expect(
      sendNoteMentionEmails({ note: NOTE, authorName: "Asha Rao", userIds: [PRIYA] }),
    ).resolves.toBeUndefined();

    service.queueRpc("claim_note_mention_emails", { data: [PRIYA, SAM], error: null });
    queueContext();
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("resend down"));
    await sendNoteMentionEmails({ note: NOTE, authorName: "Asha Rao", userIds: [PRIYA, SAM] });
    // One failure doesn't stop the other email.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("mentionExcerpt", () => {
  it("shows at most 200 characters", () => {
    const excerpt = mentionExcerpt("word ".repeat(100));
    expect(excerpt.length).toBeLessThanOrEqual(MENTION_EXCERPT_MAX);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("keeps a short note whole, with tokens as @name", () => {
    expect(mentionExcerpt(NOTE.body)).toBe("@Priya Shah can you check the system design answer?");
  });
});
