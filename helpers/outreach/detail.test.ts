import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { OUTREACH_JOB, outreachOf } from "@/test/utils/outreach";
import { getCompanyOutreach } from "./detail";

let db: SupabaseMock;
const deps = () => ({ supabase: db.client, company: { id: COMPANY_A.id } });

const row = (status: Parameters<typeof outreachOf>[0], overrides: Parameters<typeof outreachOf>[1] = {}) => ({
  ...outreachOf(status, overrides),
  job_postings: { title: OUTREACH_JOB.title },
});

const queueName = () =>
  db.queue("candidate_directory", { data: [{ user_id: PUBLIC_APPLICANT.id, full_name: "Ada Lovelace" }], error: null });

beforeEach(() => {
  db = createSupabaseMock();
});

describe("getCompanyOutreach", () => {
  it("reads one outreach of the session company with the candidate's name", async () => {
    const outreach = row("sent");
    db.queue("candidate_outreach", { data: outreach, error: null });
    queueName();

    const result = await getCompanyOutreach(deps(), outreach.id);

    const [call] = db.callsFor("candidate_outreach");
    expect(call.chain).toContainEqual({ method: "eq", args: ["id", outreach.id] });
    expect(call.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(result).toMatchObject({
      id: outreach.id,
      candidateUserId: PUBLIC_APPLICANT.id,
      candidateName: "Ada Lovelace",
      jobPostId: OUTREACH_JOB.id,
      jobTitle: OUTREACH_JOB.title,
      message: outreach.message,
      status: "sent",
      senderName: "Olive Owner",
      declineReason: null,
      candidateNote: null,
      candidateContact: null,
    });
  });

  it("gives the note and contact only with an Interested answer", async () => {
    db.queue("candidate_outreach", {
      data: row("interested", { candidate_note: "Happy to talk", candidate_contact: "ada@example.com" }),
      error: null,
    });
    queueName();
    expect(await getCompanyOutreach(deps(), "x")).toMatchObject({
      candidateNote: "Happy to talk",
      candidateContact: "ada@example.com",
    });

    // A report's note is for GetHired, not the company.
    db.queue("candidate_outreach", { data: row("reported", { candidate_note: "Spam" }), error: null });
    queueName();
    expect(await getCompanyOutreach(deps(), "x")).toMatchObject({ candidateNote: null, candidateContact: null });
  });

  it("gives the decline reason with a Not interested answer", async () => {
    db.queue("candidate_outreach", { data: row("not_interested", { decline_reason: "location" }), error: null });
    queueName();

    expect(await getCompanyOutreach(deps(), "x")).toMatchObject({ declineReason: "location" });
  });

  it("returns null when it isn't the company's, and throws on a failed read", async () => {
    db.queue("candidate_outreach", { data: null, error: null });
    expect(await getCompanyOutreach(deps(), "x")).toBeNull();

    db.queue("candidate_outreach", { data: null, error: { message: "boom" } });
    await expect(getCompanyOutreach(deps(), "x")).rejects.toThrow(/boom/);
  });
});
