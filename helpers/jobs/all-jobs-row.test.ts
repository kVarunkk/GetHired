import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { makeJobPost } from "@/test/utils/job-states";
import { allJobsRowFrom, ensurePublicJobRow } from "./all-jobs-row";

const NEW_ROW = "d0000000-0000-4000-8000-0000000000aa";
const company = { id: COMPANY_A.id, name: COMPANY_A.info.name };

const argsOf = (call: RecordedCall, method: string) => call.chain.find((c) => c.method === method)?.args;
const has = (call: RecordedCall, method: string) => call.chain.some((c) => c.method === method);

let service: SupabaseMock;
beforeEach(() => {
  service = createSupabaseMock();
});

describe("allJobsRowFrom (JLT-014)", () => {
  it("maps the posting's columns as the edit sync always has", () => {
    const posting = makeJobPost(COMPANY_A, {
      state: "draft",
      salary_range: "₹15L – ₹25L",
      experience: "2-5 years",
      equity_range: null,
    });
    expect(allJobsRowFrom(posting)).toMatchInlineSnapshot(`
      {
        "description": "Build the product UI with React and TypeScript.",
        "equity_max": null,
        "equity_min": null,
        "equity_range": null,
        "experience": "2-5 years",
        "experience_max": 5,
        "experience_min": 2,
        "job_name": "Frontend Engineer",
        "job_type": "Fulltime",
        "listed": true,
        "locations": [
          "bengaluru",
        ],
        "salary_currency": "INR",
        "salary_max": 2500000,
        "salary_min": 1500000,
        "salary_range": "₹15L – ₹25L",
        "visa_requirement": "Not Required",
      }
    `);
  });

  it("stores no currency for an empty one and leaves an unset minimum experience out", () => {
    const row = allJobsRowFrom(makeJobPost(COMPANY_A, { state: "draft", salary_currency: "", min_experience: null }));
    expect(row.salary_currency).toBeNull();
    expect(row).not.toHaveProperty("experience_min");
  });

  it("never carries the posting's lifecycle, notes or rules", () => {
    const row = allJobsRowFrom(makeJobPost(COMPANY_A, { state: "closed" }));
    for (const key of ["state", "close_reason", "status", "openings", "closes_at", "application_form", "company_id"]) {
      expect(row).not.toHaveProperty(key);
    }
  });
});

describe("allJobsRowFrom listed (JLT-060, JL-REQ-024)", () => {
  it("maps link_only to listed = false and public to true", () => {
    expect(allJobsRowFrom(makeJobPost(COMPANY_A, { state: "open", visibility: "link_only" })).listed).toBe(false);
    expect(allJobsRowFrom(makeJobPost(COMPANY_A, { state: "open", visibility: "public" })).listed).toBe(true);
  });

  it("leaves listed alone when the source has no visibility", () => {
    const posting = { ...makeJobPost(COMPANY_A, { state: "open" }) } as Record<string, unknown>;
    delete posting.visibility;
    expect(allJobsRowFrom(posting as never)).not.toHaveProperty("listed");
  });
});

describe("ensurePublicJobRow (JL-REQ-006)", () => {
  it("inserts an inactive gethired row and links it to the posting", async () => {
    const posting = makeJobPost(COMPANY_A, { state: "draft", embedding_new: "[0.1]" });
    service.queue("all_jobs", { data: { id: NEW_ROW }, error: null });
    service.queue("job_postings", { data: [{ job_id: NEW_ROW }], error: null });

    expect(await ensurePublicJobRow(service.client, posting, company)).toBe(NEW_ROW);

    const [insert] = service.callsFor("all_jobs");
    expect(argsOf(insert, "insert")?.[0]).toMatchObject({
      job_name: posting.title,
      status: "inactive",
      platform: "gethired",
      is_platform_job: true,
      company_url: `/companies/${COMPANY_A.id}`,
      company_name: COMPANY_A.info.name,
      embedding_new: "[0.1]",
    });
    const [link] = service.callsFor("job_postings");
    expect(argsOf(link, "update")?.[0]).toEqual({ job_id: NEW_ROW });
    expect(link.chain).toContainEqual({ method: "is", args: ["job_id", null] });
  });

  it("is idempotent: a posting with a row (one left by a refused open, say) gets it back, nothing inserted", async () => {
    const posting = makeJobPost(COMPANY_A, { state: "draft", job_id: "d0000000-0000-4000-8000-000000000077" });

    expect(await ensurePublicJobRow(service.client, posting, company)).toBe(posting.job_id);
    expect(service.calls).toHaveLength(0);
  });

  it("uses the row a concurrent open linked, and deletes its own", async () => {
    const winner = "d0000000-0000-4000-8000-0000000000bb";
    const posting = makeJobPost(COMPANY_A, { state: "draft" });
    service.queue("all_jobs", { data: { id: NEW_ROW }, error: null });
    service.queue("job_postings", { data: [], error: null });
    service.queue("job_postings", { data: { job_id: winner }, error: null });

    expect(await ensurePublicJobRow(service.client, posting, company)).toBe(winner);
    const deleted = service.callsFor("all_jobs").find((c) => has(c, "delete"));
    expect(deleted?.chain).toContainEqual({ method: "eq", args: ["id", NEW_ROW] });
  });

  it("throws when the row can't be created", async () => {
    service.queue("all_jobs", { data: null, error: { message: "boom" } });
    await expect(ensurePublicJobRow(service.client, makeJobPost(COMPANY_A, { state: "draft" }), company)).rejects.toThrow(
      "Failed to create the public job listing.",
    );
  });
});
