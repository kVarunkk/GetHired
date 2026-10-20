import { describe, expect, it } from "vitest";
import { render } from "react-email";
import CompanyMessageEmail from "./CompanyMessageEmail";

async function both(el: React.ReactElement) {
  return { html: await render(el), text: await render(el, { plainText: true }) };
}

const PROPS = {
  companyName: "Acme",
  companyEmail: "hr@acme.dev",
  logoUrl: "https://acme.dev/logo.png",
  subject: "Interview for Backend Engineer",
};

describe("CompanyMessageEmail (PLT-062)", () => {
  it("renders the markdown body with the company's name and the footer", async () => {
    const { html, text } = await both(
      <CompanyMessageEmail
        {...PROPS}
        bodyMd={"Hi Priya,\n\nWe'd like to **talk**. Book here: <https://cal.com/acme/intro>"}
      />,
    );

    expect(html).toContain("<strong>talk</strong>");
    expect(html).toContain('href="https://cal.com/acme/intro"');
    expect(html).toContain('src="https://acme.dev/logo.png"');
    for (const out of [html, text]) {
      expect(out).toContain("Acme");
      expect(out).toContain("Sent via GetHired on behalf of Acme. Replies go to hr@acme.dev.");
    }
  });

  it("escapes HTML in the body instead of rendering it", async () => {
    const { html } = await both(
      <CompanyMessageEmail
        {...PROPS}
        bodyMd={'Hi <script>alert(1)</script> <img src=x onerror="alert(2)"> <a href="https://evil.test">x</a>'}
      />,
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/<img[^>]*onerror/);
    expect(html).not.toContain('href="https://evil.test"');
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops images and javascript: links from markdown", async () => {
    const { html } = await both(
      <CompanyMessageEmail {...PROPS} bodyMd={"![x](https://evil.test/p.png) [click](javascript:alert(1))"} />,
    );

    expect(html).not.toContain("https://evil.test/p.png");
    expect(html).not.toContain("javascript:");
  });

  it("works without a logo or a contact email", async () => {
    const { html, text } = await both(
      <CompanyMessageEmail {...PROPS} logoUrl={null} companyEmail={null} bodyMd="Hi" />,
    );

    expect(html).not.toContain("<img");
    expect(text).toContain("Sent via GetHired on behalf of Acme.");
    expect(text).not.toContain("Replies go to");
  });
});
