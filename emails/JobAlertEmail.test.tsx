import { describe, expect, it } from "vitest";
import { render } from "react-email";
import JobAlertEmail, { jobAlertSubject, type JobAlertEmailProps } from "./JobAlertEmail";
import { jobAlertJobUrl } from "@/helpers/job-alerts/paths";

const PROPS: JobAlertEmailProps = {
  userName: "Ada",
  alertId: "a1e00000-0000-4000-8000-000000000001",
  alertName: "Frontend jobs in Bangalore",
  frequency: "weekly",
  jobs: [
    {
      id: "j1",
      job_name: "Frontend Engineer",
      company_name: "Acme",
      locations: ["Bangalore", "Bangalore", "Remote"],
      salary_range: "₹20L – ₹30L",
      created_at: "2026-11-20T00:00:00Z",
    },
  ],
  total: 6,
  baseUrl: "https://gethired.devhub.co.in",
  seeAllUrl: "https://gethired.devhub.co.in/jobs?location=bangalore&ref=job_alert&aid=x",
  pauseUrl: "https://gethired.devhub.co.in/unsubscribe/alert/a.b",
};

describe("jobAlertSubject (JAT-032)", () => {
  it("reads as the spec's example", () => {
    expect(jobAlertSubject(6, "Frontend Engineer jobs in Bangalore")).toBe("6 new Frontend Engineer jobs in Bangalore");
    expect(jobAlertSubject(3, "Jobs in Pune")).toBe("3 new jobs in Pune");
  });

  it("cuts to 70 characters", () => {
    const subject = jobAlertSubject(12, "Software Engineer, Backend Developer jobs in Bangalore, Hyderabad · Fulltime · 2–5 yrs");
    expect(subject.length).toBeLessThanOrEqual(70);
    expect(subject.endsWith("…")).toBe(true);
  });
});

describe("jobAlertJobUrl", () => {
  it("carries ref=job_alert and the alert id, never src=", () => {
    const url = jobAlertJobUrl("https://x.test", "j1", "a1");
    expect(url).toBe("https://x.test/jobs/j1?ref=job_alert&aid=a1");
    expect(url).not.toContain("src=");
  });
});

describe("JobAlertEmail (JAT-032)", () => {
  it.each(["daily", "weekly"] as const)("has the %s footer with the pause and manage links", async (frequency) => {
    const html = await render(<JobAlertEmail {...PROPS} frequency={frequency} />);
    const text = await render(<JobAlertEmail {...PROPS} frequency={frequency} />, { plainText: true });
    expect(text).toContain(`You get this ${frequency} because you created an alert for Frontend jobs in Bangalore.`);
    expect(html).toContain(`href="${PROPS.pauseUrl}"`);
    expect(html).toContain('href="https://gethired.devhub.co.in/settings#job-alerts"');
    for (const label of ["Pause this alert", "Change frequency", "Manage all alerts"]) expect(text).toContain(label);
  });

  it("lists the jobs and links to see all", async () => {
    const html = await render(<JobAlertEmail {...PROPS} />);
    expect(html).toContain("Frontend Engineer");
    expect(html).toContain("Acme · Bangalore, Remote");
    expect(html).toContain("See all 6 →");
    expect(html).toContain("/jobs/j1?ref=job_alert&amp;aid=a1e00000-0000-4000-8000-000000000001");
  });

  it("has no See all when every job is shown", async () => {
    const html = await render(<JobAlertEmail {...PROPS} total={1} />);
    expect(html).not.toContain("See all");
  });
});
