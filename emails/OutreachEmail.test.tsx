import { describe, expect, it } from "vitest";
import { render } from "react-email";
import OutreachEmail from "./OutreachEmail";

async function both(el: React.ReactElement) {
  return { html: await render(el), text: await render(el, { plainText: true }) };
}

const PROPS = {
  companyName: "Acme",
  logoUrl: null,
  jobTitle: "Frontend Engineer",
  subject: "Frontend role at Acme",
  respondUrl: "https://gethired.devhub.co.in/opportunities/f0000000-0000-4000-8000-000000000001",
  settingsUrl: "https://gethired.devhub.co.in/dashboard",
};

describe("OutreachEmail (ORT-023)", () => {
  it("says who the message is from and links only to the respond page", async () => {
    const { html, text } = await both(<OutreachEmail {...PROPS} message="Hi Ada, open to a chat?" />);

    for (const out of [html, text]) {
      expect(out).toContain("Message from Acme");
      expect(out).toContain("About: Frontend Engineer");
      expect(out).toContain("Hi Ada, open to a chat?");
      expect(out).toContain("View and respond");
    }
    expect(html).toContain(`href="${PROPS.respondUrl}"`);
    // No one-click answers (ALT-003).
    expect(html).not.toMatch(/Interested<\/a>|Not interested<\/a>/);
    expect(html).not.toMatch(/respond\?status=|token=/);
  });

  it("renders HTML and markdown in the message as text", async () => {
    const message =
      '<a href="javascript:alert(1)">click</a> <img src=x onerror="alert(2)"> [docs](javascript:alert(3)) **bold**';
    const { html } = await both(<OutreachEmail {...PROPS} message={message} />);

    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("onerror=\"alert");
    expect(html).not.toContain("<strong>");
    expect(html).toContain("&lt;a href=");
    expect(html).toContain("[docs](javascript:alert(3))");
  });

  it("links https URLs and nothing else", async () => {
    const message = "Book: https://cal.com/acme/intro. Old site http://acme.test ftp://acme.test";
    const { html } = await both(<OutreachEmail {...PROPS} message={message} />);

    expect(html).toContain('href="https://cal.com/acme/intro"');
    expect(html).not.toContain('href="http://acme.test');
    expect(html).not.toContain('href="ftp://');
    expect(html).toContain("http://acme.test");
  });

  it("keeps line breaks and paragraphs", async () => {
    const { html } = await both(<OutreachEmail {...PROPS} message={"Line one\nLine two\n\nNew paragraph"} />);
    expect(html).toMatch(/Line one<br\/?>Line two/);
    expect(html).toContain("New paragraph");
  });

  it("leaves out the job line without a job", async () => {
    const { text } = await both(<OutreachEmail {...PROPS} jobTitle={null} message="Hi" />);
    expect(text).not.toContain("About:");
  });
});
