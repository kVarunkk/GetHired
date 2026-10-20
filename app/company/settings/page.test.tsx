import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { listStages } from "@/helpers/pipeline/stages";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import CompanySettingsPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/pipeline/stages", () => ({ listStages: vi.fn() }));
vi.mock("@/components/pipeline/StageEditor", () => ({ default: () => <input aria-label="Stage name" /> }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (orig) => ({ ...(await orig()), useRouter: () => ({ push: vi.fn() }) }));

function signInAs(member: MemberFixture) {
  const db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  vi.mocked(createClient).mockResolvedValue(db.client);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listStages).mockResolvedValue([]);
});

describe("/company/settings, pipeline stages (RP-REQ-016, RPT-024)", () => {
  it("makes the stage editor read-only, with the reason, without settings.stages", async () => {
    signInAs(MEMBER_A);
    render(await CompanySettingsPage());

    const message = forbiddenMessage("settings.stages");
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Stage name")).toBeDisabled();
    expect(screen.getByLabelText("Stage name").closest("fieldset")).toHaveAttribute("title", message);
  });

  it("lets an owner edit the stages", async () => {
    signInAs(OWNER_A);
    render(await CompanySettingsPage());

    expect(screen.getByLabelText("Stage name")).toBeEnabled();
  });

  it("offers only pipeline chips, and the editing ones only with settings.stages", async () => {
    signInAs(OWNER_A);
    const { unmount } = render(await CompanySettingsPage());
    expect(screen.getByRole("link", { name: "Add a stage" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/company\/agent\?prompt=/),
    );
    expect(screen.queryByRole("link", { name: "Write an email template" })).not.toBeInTheDocument();
    unmount();

    signInAs(MEMBER_A);
    render(await CompanySettingsPage());
    expect(screen.queryByRole("link", { name: "Add a stage" })).not.toBeInTheDocument();
  });
});
