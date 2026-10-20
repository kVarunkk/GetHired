import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import useSWR from "swr";
import { COMPANY_A } from "@/test/utils/recruiter";
import ProfileDropdown from "./ProfileDropdown";

vi.mock("swr", () => ({ default: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

function profileWith(billingView: boolean) {
  vi.mocked(useSWR).mockReturnValue({
    data: {
      role: "company",
      profile: {
        roleLabel: "Interviewer",
        plan: { name: "Startup", slug: "startup", credits: 1240 },
        access: { billingView, isOwner: false },
      },
    },
  } as ReturnType<typeof useSWR>);
}

async function openMenu() {
  render(<ProfileDropdown user={COMPANY_A.user} isMenuOpen={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Profile" }));
}

beforeEach(() => vi.clearAllMocks());

describe("ProfileDropdown billing link (RP-REQ-016)", () => {
  it("links to billing with billing.view", async () => {
    profileWith(true);
    await openMenu();

    expect(await screen.findByRole("menuitem", { name: /Plan: Startup/ })).toHaveAttribute("href", "/company/billing");
  });

  it("has no billing link without billing.view", async () => {
    profileWith(false);
    await openMenu();

    expect(await screen.findByText("Interviewer")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Plan: Startup/ })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/company/billing"]')).toBeNull();
  });
});
