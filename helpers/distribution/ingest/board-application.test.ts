import { describe, expect, it } from "vitest";
import { talentAdapter, talentApplyPostUrl, talentApplyToken } from "./board-application";

const JOB = "b0000000-0000-4000-8000-0000000000b1";
const body = (over: Record<string, unknown> = {}) => ({
  id: "t-1",
  job: { jobId: JOB, jobTitle: "Backend Engineer", jobCompany: "Acme", jobLocation: "Bengaluru" },
  applicant: {
    fullName: "Ada Lovelace",
    email: "Ada@Example.com",
    phoneNumber: "+91 98765 43210",
    resume: { file: { fileName: "ada.pdf", contentType: "application/pdf", data: "JVBERi0=" } },
  },
  analytics: { ip: "1.2.3.4", useragent: "ua", device: "mobile" },
  questions: { answers: [{ id: "q1", value: "yes" }] },
  ...over,
});

describe("Talent Apply", () => {
  it("puts a per-job token in the posturl that only verifies for that job", () => {
    const url = new URL(talentApplyPostUrl(JOB, "s"));
    expect(url.origin + url.pathname).toBe("https://gethired.devhub.co.in/api/webhooks/jobboards/talent");
    expect(url.searchParams.get("token")).toBe(talentApplyToken(JOB, "s"));
    expect(url.searchParams.get("token")).not.toContain("s=");

    const raw = JSON.stringify(body());
    expect(talentAdapter.verify(raw, new Headers(), "s", url)).toBe(true);
    expect(talentAdapter.verify(raw, new Headers(), "other", url)).toBe(false);
    const otherJob = JSON.stringify(body({ job: { jobId: "b0000000-0000-4000-8000-0000000000b2" } }));
    expect(talentAdapter.verify(otherJob, new Headers(), "s", url)).toBe(false);
    expect(talentAdapter.verify("not json", new Headers(), "s", url)).toBe(false);
  });

  it("reads their JSON standard example and keeps contact details out of the summary", () => {
    const app = talentAdapter.parse(body())!;
    expect(app).toMatchObject({
      externalId: "t-1",
      jobRef: JOB,
      applicant: { fullName: "Ada Lovelace", email: "ada@example.com", phone: "+91 98765 43210" },
      resumeBase64: "JVBERi0=",
    });
    expect(JSON.stringify(app.summary)).not.toMatch(/ada|98765|1\.2\.3\.4|JVBERi0/i);
  });

  it("refuses a payload without a name, email or job id", () => {
    expect(talentAdapter.parse(body({ applicant: { email: "a@b.co" } }))).toBeNull();
    expect(talentAdapter.parse(body({ job: { jobId: "not-a-uuid" } }))).toBeNull();
  });
});
