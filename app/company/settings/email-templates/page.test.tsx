import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import EmailTemplatesSettingsPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/components/pipeline/TemplateEditor", () => ({ default: () => <input aria-label="Template subject" /> }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (orig) => ({ ...(await orig()), useRouter: () => ({ push: vi.fn() }) }));

function signInAs(member: MemberFixture) {
  const db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  db.queue("company_email_templates", { data: [], error: null });
  db.queue("company_info", { data: { scheduling_url: null }, error: null });
  vi.mocked(createClient).mockResolvedValue(db.client);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/company/settings/email-templates (RP-REQ-016, RPT-024)", () => {
  it("makes the templates editor read-only, with the reason, without settings.templates", async () => {
    signInAs(MEMBER_A);
    render(await EmailTemplatesSettingsPage());

    const message = forbiddenMessage("settings.templates");
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Template subject")).toBeDisabled();
    expect(screen.getByLabelText("Template subject").closest("fieldset")).toHaveAttribute("title", message);
  });

  it("lets an owner edit the templates", async () => {
    signInAs(OWNER_A);
    render(await EmailTemplatesSettingsPage());

    expect(screen.getByLabelText("Template subject")).toBeEnabled();
  });

  it("shows the agent box only with settings.templates", async () => {
    signInAs(OWNER_A);
    const { unmount } = render(await EmailTemplatesSettingsPage());
    expect(screen.getByRole("link", { name: "Write a template" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/company\/agent\?prompt=/),
    );
    unmount();

    signInAs(MEMBER_A);
    render(await EmailTemplatesSettingsPage());
    expect(screen.queryByRole("link", { name: "Write a template" })).not.toBeInTheDocument();
  });
});
