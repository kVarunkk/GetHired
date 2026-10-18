import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { listStages } from "@/helpers/pipeline/stages";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import CompanySettingsPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/pipeline/stages", () => ({ listStages: vi.fn() }));
vi.mock("@/components/pipeline/StageEditor", () => ({ default: () => <input aria-label="Stage name" /> }));
vi.mock("@/components/pipeline/TemplateEditor", () => ({ default: () => <input aria-label="Template subject" /> }));
vi.mock("@/components/pipeline/SchedulingLinkForm", () => ({ default: () => <input aria-label="Scheduling link" /> }));
vi.mock("@/components/pipeline/NotificationSettings", () => ({ default: () => <input aria-label="Notifications" /> }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (orig) => ({ ...(await orig()), useRouter: () => ({ push: vi.fn() }) }));

let db: SupabaseMock;

function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  db.queue("company_email_templates", { data: [], error: null });
  db.queue("company_info", {
    data: { scheduling_url: null, notify_new_applicants: "off", notify_weekly_matches: false },
    error: null,
  });
  vi.mocked(createClient).mockResolvedValue(db.client);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listStages).mockResolvedValue([]);
});

describe("/company/settings (RP-REQ-016, RPT-024)", () => {
  it("makes the templates editor read-only, with the reason, without settings.templates", async () => {
    signInAs(MEMBER_A);
    render(await CompanySettingsPage());

    const message = forbiddenMessage("settings.templates");
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Template subject")).toBeDisabled();
    expect(screen.getByLabelText("Template subject").closest("fieldset")).toHaveAttribute("title", message);
  });

  it("lets an owner edit every section", async () => {
    signInAs(OWNER_A);
    render(await CompanySettingsPage());

    for (const label of ["Stage name", "Template subject", "Scheduling link", "Notifications"]) {
      expect(screen.getByLabelText(label)).toBeEnabled();
    }
    expect(screen.getByRole("link", { name: /Audit log/ })).toHaveAttribute("href", "/company/settings/audit");
  });

  it("shows only the settings links the role can open", async () => {
    signInAs(MEMBER_A);
    render(await CompanySettingsPage());

    expect(screen.getByRole("link", { name: /Team/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Roles/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Audit log/ })).not.toBeInTheDocument();
    // CP-REQ-012: everyone can open the careers page editor (read-only without careers.edit).
    expect(screen.getByRole("link", { name: /Careers page/ })).toHaveAttribute("href", "/company/settings/careers");
  });

  it("offers agent suggestions only for the settings the role can change", async () => {
    signInAs(OWNER_A);
    const { unmount } = render(await CompanySettingsPage());
    expect(screen.getByRole("link", { name: "Add a pipeline stage" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/company\/agent\?prompt=/),
    );
    expect(screen.getByRole("link", { name: "Write an email template" })).toBeInTheDocument();
    unmount();

    signInAs(MEMBER_A);
    render(await CompanySettingsPage());
    expect(screen.queryByRole("link", { name: "Write an email template" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add a pipeline stage" })).not.toBeInTheDocument();
  });
});
