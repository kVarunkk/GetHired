import { describe, expect, it } from "vitest";
import { render } from "react-email";
import { deploymentUrl } from "@/utils/formatters";
import CompanyInviteEmail from "./CompanyInviteEmail";

const JOIN_URL = `${deploymentUrl()}/company/join?token=tok_abc`;

describe("CompanyInviteEmail (TMT-033)", () => {
  it("names the company, the inviter and the role, and links to the join page", async () => {
    const html = await render(
      <CompanyInviteEmail companyName="Acme" inviterName="Olive Owner" roleName="Admin" joinUrl={JOIN_URL} />,
    );

    expect(html).toContain("Join Acme on GetHired");
    expect(html).toContain("Olive Owner invited you");
    expect(html).toContain("with the Admin role");
    expect(html).toContain(`href="${JOIN_URL}"`);
    expect(JOIN_URL).toContain("/company/join?token=");
  });

  it("says the link expires in 7 days", async () => {
    const text = await render(
      <CompanyInviteEmail companyName="Acme" inviterName="Olive" roleName="Member" joinUrl={JOIN_URL} />,
      { plainText: true },
    );

    expect(text).toContain("expires in 7 days");
    expect(text).toContain("with the Member role");
  });

  it("escapes the names", async () => {
    const html = await render(
      <CompanyInviteEmail companyName={'<img src=x onerror="alert(1)">'} inviterName="O" roleName="Member" joinUrl={JOIN_URL} />,
    );

    expect(html).not.toContain("<img src=x");
  });
});
