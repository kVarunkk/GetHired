import { describe, expect, it } from "vitest";
import { render } from "react-email";
import InterviewInviteEmail from "./InterviewInviteEmail";
import InterviewReminderEmail from "./InterviewReminderEmail";
import InterviewExpiredEmail from "./InterviewExpiredEmail";
import InterviewCompletedCompanyEmail from "./InterviewCompletedCompanyEmail";
import InterviewAccommodationRequestEmail from "./InterviewAccommodationRequestEmail";

const URL = "https://gethired.devhub.co.in/interview/screening/ai1";
const DEADLINE = "2026-10-24T12:00:00.000Z"; // 5:30 PM IST
const text = (node: React.ReactElement) => render(node, { plainText: true });

describe("InterviewInviteEmail (SI-REQ-013)", () => {
  const email = (
    <InterviewInviteEmail
      firstName="Priya"
      companyName="Acme"
      jobTitle="Backend Engineer"
      durationMinutes={15}
      competencyNames={["System design", "Communication"]}
      deadlineAt={DEADLINE}
      interviewUrl={URL}
    />
  );

  it("names the company, role, length, competencies and deadline, and links to the interview", async () => {
    const plain = await text(email);
    expect(plain).toContain("Hi Priya");
    expect(plain).toContain("Acme");
    expect(plain).toContain("Backend Engineer");
    expect(plain).toContain("15-minute");
    expect(plain).toContain("System design");
    expect(plain).toContain("Communication");
    expect(plain).toContain("October 24, 2026");
    expect(await render(email)).toContain(`href="${URL}"`);
  });

  it("says a person decides and audio isn't stored", async () => {
    const plain = await text(email);
    expect(plain).toContain("Acme makes the decision");
    expect(plain).toContain("Audio isn't stored");
  });

  it("escapes the company name", async () => {
    const html = await render(
      <InterviewInviteEmail
        firstName={null}
        companyName={'<img src=x onerror="alert(1)">'}
        jobTitle="Role"
        durationMinutes={10}
        competencyNames={["A"]}
        deadlineAt={DEADLINE}
        interviewUrl={URL}
      />,
    );
    expect(html).not.toContain("<img src=x");
  });
});

describe("InterviewReminderEmail (SI-REQ-014)", () => {
  it("names the role and the deadline and links to the interview", async () => {
    const node = (
      <InterviewReminderEmail
        companyName="Acme"
        jobTitle="Backend Engineer"
        durationMinutes={20}
        deadlineAt={DEADLINE}
        interviewUrl={URL}
      />
    );
    const plain = await text(node);
    expect(plain).toContain("Backend Engineer");
    expect(plain).toContain("October 24, 2026");
    expect(plain).toContain("20 minutes");
    expect(await render(node)).toContain(`href="${URL}"`);
  });
});

describe("InterviewExpiredEmail (SI-REQ-014)", () => {
  it("tells the candidate their invite expired", async () => {
    const plain = await text(
      <InterviewExpiredEmail audience="candidate" companyName="Acme" jobTitle="Backend Engineer" />,
    );
    expect(plain).toContain("AI interview for Backend Engineer at Acme has expired");
  });

  it("tells the company, with a link to the applicant", async () => {
    const node = (
      <InterviewExpiredEmail
        audience="company"
        companyName="Acme"
        jobTitle="Backend Engineer"
        candidateName="Priya"
        applicantUrl="https://x/app"
      />
    );
    expect(await text(node)).toContain("Priya didn't take the AI interview for Backend Engineer");
    expect(await render(node)).toContain('href="https://x/app"');
  });
});

describe("InterviewCompletedCompanyEmail", () => {
  it("links to the report and labels it as a screening signal", async () => {
    const node = (
      <InterviewCompletedCompanyEmail candidateName="Priya" jobTitle="Backend Engineer" reportUrl="https://x/report" scored />
    );
    const plain = await text(node);
    expect(plain).toContain("Priya finished the AI interview for Backend Engineer");
    expect(plain).toContain("AI-generated");
    expect(await render(node)).toContain('href="https://x/report"');
  });

  it("says when there's nothing to score", async () => {
    const plain = await text(
      <InterviewCompletedCompanyEmail candidateName="Priya" jobTitle="Backend Engineer" reportUrl="https://x" scored={false} />,
    );
    expect(plain).toContain("too short to score");
  });
});

describe("InterviewAccommodationRequestEmail (SI-REQ-016/026)", () => {
  it("quotes the request and lists the options", async () => {
    const plain = await text(
      <InterviewAccommodationRequestEmail
        kind="accommodation"
        candidateName="Priya"
        jobTitle="Backend Engineer"
        message="I have a hearing impairment."
        applicantUrl="https://x/app"
      />,
    );
    expect(plain).toContain("Priya asked for an alternative to the AI interview for Backend Engineer");
    expect(plain).toContain("I have a hearing impairment.");
    expect(plain).toMatch(/extend[\s\S]*waive[\s\S]*cancel/i);
  });

  it("tells the company the candidate declined", async () => {
    const plain = await text(
      <InterviewAccommodationRequestEmail kind="declined" candidateName="Priya" jobTitle="Backend Engineer" applicantUrl="https://x" />,
    );
    expect(plain).toContain("Priya declined the AI interview for Backend Engineer");
    expect(plain).toContain("application is still open");
  });
});

describe("candidate emails never show a score", () => {
  it.each([
    <InterviewInviteEmail
      key="i"
      firstName="P"
      companyName="Acme"
      jobTitle="R"
      durationMinutes={15}
      competencyNames={["A"]}
      deadlineAt={DEADLINE}
      interviewUrl={URL}
    />,
    <InterviewReminderEmail key="r" companyName="Acme" jobTitle="R" durationMinutes={15} deadlineAt={DEADLINE} interviewUrl={URL} />,
    <InterviewExpiredEmail key="e" audience="candidate" companyName="Acme" jobTitle="R" />,
  ])("%#", async (node) => {
    expect(await text(node)).not.toMatch(/score|\/5\b|rating/i);
  });
});
