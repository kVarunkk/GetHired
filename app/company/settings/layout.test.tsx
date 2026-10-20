import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import CompanySettingsLayout from "./layout";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (orig) => ({ ...(await orig()), usePathname: () => "/company/settings" }));

function signInAs(member: MemberFixture) {
  const db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  vi.mocked(createClient).mockResolvedValue(db.client);
}

async function renderNav() {
  render(<TooltipProvider>{await CompanySettingsLayout({ children: <p>Section</p> })}</TooltipProvider>);
  // The desktop sidebar; the phone row repeats the same links.
  return screen.getAllByRole("navigation", { name: "Settings sections" })[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/company/settings layout (RP-REQ-016)", () => {
  it("links every section for an owner, with no back link", async () => {
    signInAs(OWNER_A);
    const nav = await renderNav();

    expect(within(nav).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
      "/company/settings",
      "/company/settings/email-templates",
      "/company/settings/scheduling",
      "/company/settings/notifications",
      "/company/settings/careers",
      "/company/settings/question-sets",
      "/company/settings/team",
      "/company/settings/hiring-teams",
      "/company/settings/roles",
      "/company/settings/audit",
    ]);
    expect(within(nav).getByRole("link", { name: "Pipeline stages" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Section")).toBeInTheDocument();
  });

  it("shows only the sections the role can open", async () => {
    signInAs(MEMBER_A);
    const nav = await renderNav();

    expect(within(nav).getByRole("link", { name: "Team" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Roles" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Audit log" })).not.toBeInTheDocument();
    // CP-REQ-012: everyone can open the careers page editor (read-only without careers.edit).
    expect(within(nav).getByRole("link", { name: "Careers page" })).toHaveAttribute("href", "/company/settings/careers");
  });
});
