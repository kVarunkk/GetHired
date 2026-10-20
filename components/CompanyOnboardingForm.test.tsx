import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { saveCompanyProfileAction } from "@/app/actions/company/save-company-profile";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import CompanyOnboardingForm from "./CompanyOnboardingForm";

const mock = vi.hoisted(() => ({ current: null as ReturnType<typeof createSupabaseMock> | null }));

vi.mock("@/lib/supabase/client", async () => {
  const { createSupabaseMock } = await import("@/test/utils/supabase-mock");
  mock.current = createSupabaseMock();
  return { createClient: () => mock.current!.client };
});
vi.mock("@/app/actions/company/save-company-profile", () => ({ saveCompanyProfileAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./LocationSearchSelect", () => ({ default: () => <div data-testid="location" /> }));

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const EXISTING = {
  id: COMPANY_A.id,
  name: "Acme",
  description: "We build things. ".repeat(20),
  website: "https://acme.dev",
  industry: "Technology",
  headquarters: "bengaluru",
  company_size: "11-50",
  tag_line: "Hire fast",
  logo_url: null,
};

const supabase = () => mock.current!;

async function renderLoaded(access: "owner" | "admin" | "member" | "profile" = "owner") {
  // RP-REQ-002: owners and roles with company.profile edit; Admin and Member don't.
  const canEditProfile = access === "owner" || access === "profile";
  supabase().queue("company_info", { data: EXISTING, error: null });
  render(<CompanyOnboardingForm user={COMPANY_A.user} company={{ id: COMPANY_A.id, canEditProfile }} />);
  await waitFor(() => expect(screen.getByPlaceholderText("Acme Inc.")).toHaveValue("Acme"));
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Complete Onboarding" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase().reset();
});

/** The FormData of the one save call. */
const savedForm = () => vi.mocked(saveCompanyProfileAction).mock.calls[0][0];

describe("CompanyOnboardingForm save", () => {
  it("saves through the server action and never writes from the browser", async () => {
    vi.mocked(saveCompanyProfileAction).mockResolvedValue({ ok: true, logoUrl: null });
    await renderLoaded();

    submit();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/company"));
    expect(JSON.parse(String(savedForm().get("values")))).toMatchObject({ name: "Acme", industry: "Technology" });
    expect(savedForm().get("removeLogo")).toBeNull();
    // Only the initial load reads company_info in the browser.
    expect(supabase().callsFor("company_info")).toHaveLength(1);
  });

  it("toasts the action's error and stays on the page", async () => {
    vi.mocked(saveCompanyProfileAction).mockResolvedValue({ ok: false, error: "Company profile not found." });
    await renderLoaded();

    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Company profile not found."));
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("CompanyOnboardingForm for team members", () => {
  it("loads the company by id, not by the owner's user_id", async () => {
    await renderLoaded("member");

    const load = supabase().callsFor("company_info")[0];
    expect(load.chain).toContainEqual({ method: "eq", args: ["id", COMPANY_A.id] });
    expect(load.chain).not.toContainEqual({ method: "eq", args: ["user_id", COMPANY_A.user.id] });
  });

  it.each(["admin", "member"] as const)("shows the profile read-only to a %s", async (role) => {
    await renderLoaded(role);

    expect(screen.getByPlaceholderText("Acme Inc.")).toBeDisabled();
    expect(screen.getByText("Your role can't edit the company profile.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete Onboarding" })).not.toBeInTheDocument();
  });

  it.each(["owner", "profile"] as const)("lets an %s edit (owners, or a role with company.profile)", async (access) => {
    await renderLoaded(access);

    expect(screen.getByPlaceholderText("Acme Inc.")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Complete Onboarding" })).toBeInTheDocument();
  });

  it("explains when the account has no company, without querying", () => {
    render(<CompanyOnboardingForm user={COMPANY_A.user} company={null} />);

    expect(screen.getByText("Your account isn't part of a company")).toBeInTheDocument();
    expect(supabase().callsFor("company_info")).toHaveLength(0);
  });
});
