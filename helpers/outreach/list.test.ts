import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PRIVATE_APPLIED_TO_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { OUTREACH_JOB, outreachOf } from "@/test/utils/outreach";
import {
  decodeCursor,
  encodeCursor,
  listCompanyOutreach,
  listMyOpportunities,
  outreachStatusFor,
} from "./list";

let db: SupabaseMock;
const deps = () => ({ supabase: db.client, company: { id: COMPANY_A.id } });

const row = (status: Parameters<typeof outreachOf>[0], overrides: Parameters<typeof outreachOf>[1] = {}) => ({
  ...outreachOf(status, overrides),
  job_postings: { title: OUTREACH_JOB.title },
});

/** The three head counts: total, withdrawn, answered. */
function queueCounts(total: number, withdrawn: number, answered: number) {
  db.queue("candidate_outreach", { data: null, error: null, count: total });
  db.queue("candidate_outreach", { data: null, error: null, count: withdrawn });
  db.queue("candidate_outreach", { data: null, error: null, count: answered });
}

beforeEach(() => {
  db = createSupabaseMock();
});

describe("listCompanyOutreach (ORT-026)", () => {
  it("filters by the session company, newest first, 25 a page with a sent_at,id cursor", async () => {
    const rows = Array.from({ length: 26 }, (_, i) =>
      row("sent", { sent_at: new Date(Date.UTC(2026, 9, 26 - i)).toISOString() }),
    );
    db.queue("candidate_outreach", { data: rows, error: null });
    queueCounts(26, 0, 0);
    db.queue("candidate_directory", { data: [{ user_id: PUBLIC_APPLICANT.id, full_name: "Ada Lovelace" }], error: null });

    const page = await listCompanyOutreach(deps());

    const [list] = db.callsFor("candidate_outreach");
    expect(list.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(list.chain).toContainEqual({ method: "order", args: ["sent_at", { ascending: false }] });
    expect(list.chain).toContainEqual({ method: "limit", args: [26] });
    expect(page.items).toHaveLength(25);
    expect(page.items[0].candidateName).toBe("Ada Lovelace");
    expect(page.nextCursor).toBe(encodeCursor(rows[24].sent_at, rows[24].id));
  });

  it("returns the sender's stored name, even after they've left (TMT-061)", async () => {
    db.queue("candidate_outreach", { data: [row("sent", { sender_name: "Max Member", sender_user_id: null })], error: null });
    queueCounts(1, 0, 0);

    const page = await listCompanyOutreach(deps());

    expect(String(db.callsFor("candidate_outreach")[0].chain.find((m) => m.method === "select")?.args[0])).toContain(
      "sender_name",
    );
    expect(page.items[0].senderName).toBe("Max Member");
  });

  it("applies the job, status and cursor filters", async () => {
    db.queue("candidate_outreach", { data: [], error: null });
    queueCounts(0, 0, 0);
    const cursor = encodeCursor("2026-10-01T09:00:00.000Z", "f0000000-0000-4000-8000-000000000001");

    await listCompanyOutreach(deps(), { jobPostId: OUTREACH_JOB.id, status: "interested", cursor });

    const [list, total] = db.callsFor("candidate_outreach");
    expect(list.chain).toContainEqual({ method: "eq", args: ["job_post_id", OUTREACH_JOB.id] });
    expect(list.chain).toContainEqual({ method: "eq", args: ["status", "interested"] });
    expect(list.chain).toContainEqual({
      method: "or",
      args: [
        "sent_at.lt.2026-10-01T09:00:00.000Z,and(sent_at.eq.2026-10-01T09:00:00.000Z,id.lt.f0000000-0000-4000-8000-000000000001)",
      ],
    });
    // The reply rate covers the job filter, not the status filter.
    expect(total.chain).toContainEqual({ method: "eq", args: ["job_post_id", OUTREACH_JOB.id] });
    expect(total.chain).not.toContainEqual({ method: "eq", args: ["status", "interested"] });
  });

  it("computes the reply rate as answered ÷ (sent − withdrawn)", async () => {
    db.queue("candidate_outreach", { data: [], error: null });
    queueCounts(10, 2, 4);

    expect((await listCompanyOutreach(deps())).replyRate).toBe(0.5);
  });

  it("has no reply rate with nothing sent (or everything withdrawn)", async () => {
    db.queue("candidate_outreach", { data: [], error: null });
    queueCounts(3, 3, 0);

    expect((await listCompanyOutreach(deps())).replyRate).toBeNull();
  });

  it("names private candidates (applicants, interested) from user_info", async () => {
    db.queue("candidate_outreach", { data: [row("interested", { candidate_user_id: PRIVATE_APPLIED_TO_A.id })], error: null });
    queueCounts(1, 0, 1);
    db.queue("candidate_directory", { data: [], error: null });
    db.queue("user_info", { data: [{ user_id: PRIVATE_APPLIED_TO_A.id, full_name: "Grace Hopper" }], error: null });

    const page = await listCompanyOutreach(deps());

    expect(page.items[0].candidateName).toBe("Grace Hopper");
    const select = String(db.callsFor("user_info")[0].chain.find((c) => c.method === "select")?.args[0]);
    expect(select).not.toMatch(/email/);
  });

  it("ignores a malformed cursor", () => {
    expect(decodeCursor("garbage")).toBeNull();
    expect(decodeCursor("2026-10-01|not-a-uuid")).toBeNull();
  });
});

describe("outreachStatusFor (ORT-026)", () => {
  it("returns the newest outreach per candidate for the company", async () => {
    const newest = outreachOf("interested", { sent_at: "2026-10-10T00:00:00.000Z" });
    const older = outreachOf("expired", { sent_at: "2026-09-01T00:00:00.000Z" });
    db.queue("candidate_outreach", { data: [newest, older], error: null });

    const badges = await outreachStatusFor(deps(), [PUBLIC_APPLICANT.id, PUBLIC_APPLICANT.id]);

    expect(badges).toEqual({
      [PUBLIC_APPLICANT.id]: { id: newest.id, status: "interested", sentAt: newest.sent_at },
    });
    expect(db.callsFor("candidate_outreach")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("doesn't query for no candidates", async () => {
    expect(await outreachStatusFor(deps(), [])).toEqual({});
    expect(db.calls).toHaveLength(0);
  });
});

describe("listMyOpportunities (ORT-026)", () => {
  it("lists open outreach first, then answered, with company and job", async () => {
    const future = new Date(Date.now() + 10 * 86400000).toISOString();
    const answered = { ...outreachOf("interested", { sent_at: "2026-10-12T00:00:00.000Z" }), company_info: { name: "Acme", logo_url: null }, job_postings: { title: "FE" } };
    const open = { ...outreachOf("sent", { sent_at: "2026-10-01T00:00:00.000Z", expires_at: future }), company_info: { name: "Globex", logo_url: "https://logo" }, job_postings: null };
    db.queue("candidate_outreach", { data: [answered, open], error: null });

    const items = await listMyOpportunities(db.client, PUBLIC_APPLICANT.id);

    expect(items.map((o) => o.status)).toEqual(["sent", "interested"]);
    expect(items[0]).toMatchObject({ companyName: "Globex", companyLogo: "https://logo", jobTitle: null });
    expect(db.callsFor("candidate_outreach")[0].chain).toContainEqual({
      method: "eq",
      args: ["candidate_user_id", PUBLIC_APPLICANT.id],
    });
  });
});
