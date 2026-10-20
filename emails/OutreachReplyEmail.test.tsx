import { describe, expect, it } from "vitest";
import { render } from "react-email";
import OutreachReplyEmail from "./OutreachReplyEmail";

const PROPS = {
  candidateFirstName: "Ada",
  subject: "Frontend role at Acme",
  jobTitle: "Frontend Engineer",
  note: "Happy to talk next week.",
  contact: "+91 98765 43210",
  declineReason: null,
  profileUrl: "https://gethired.devhub.co.in/company/profiles/a0000000-0000-4000-8000-000000000001",
};

describe("OutreachReplyEmail (ORT-023)", () => {
  it("shows the note and contact for interested, and links to the profile", async () => {
    const html = await render(<OutreachReplyEmail {...PROPS} status="interested" />);

    expect(html).toContain("Ada is interested");
    expect(html).toContain("Happy to talk next week.");
    expect(html).toContain("Preferred contact: +91 98765 43210");
    expect(html).toContain(`href="${PROPS.profileUrl}"`);
  });

  it("never shows a note or contact for not interested, but shows the reason", async () => {
    const html = await render(
      <OutreachReplyEmail {...PROPS} status="not_interested" declineReason="compensation" />,
    );

    expect(html).toContain("isn&#x27;t interested");
    expect(html).not.toContain("Happy to talk next week.");
    expect(html).not.toContain("+91 98765 43210");
    expect(html).toContain("Reason: Compensation");
  });

  it("escapes the candidate's note", async () => {
    const html = await render(
      <OutreachReplyEmail {...PROPS} status="interested" note={'<img src=x onerror="alert(1)">'} />,
    );
    expect(html).not.toContain("<img src=x");
  });
});
