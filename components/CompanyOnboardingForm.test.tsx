import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { markMyOnboardingComplete } from "@/app/actions/update-user-metadata";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import CompanyOnboardingForm from "./CompanyOnboardingForm";

const mock = vi.hoisted(() => ({ current: null as ReturnType<typeof createSupabaseMock> | null }));

vi.mock("@/lib/supabase/client", async () => {
  const { createSupabaseMock } = await import("@/test/utils/supabase-mock");
  mock.current = createSupabaseMock();
  return { createClient: () => mock.current!.client };
});
vi.mock("@/app/actions/update-user-metadata", () => ({ markMyOnboardingComplete: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./LocationSearchSelect", () => ({ default: () => <div data-testid="location" /> }));

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const BILLING_COLUMNS = ["tier_id", "ai_credits", "job_posts_created"];

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

/** The save chain: the second company_info call (the first is the initial load). */
const saveCall = () => supabase().callsFor("company_info")[1];

beforeEach(() => {
  vi.clearAllMocks();
  supabase().reset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

describe("CompanyOnboardingForm save (TM-SEC-007)", () => {
  it("updates the company's existing row and never upserts or inserts", async () => {
    vi.mocked(markMyOnboardingComplete).mockResolvedValue({ error: null });
    await renderLoaded();
    supabase().queue("company_info", { data: { id: COMPANY_A.id }, error: null });

    submit();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/company"));
    const methods = saveCall().chain.map((c) => c.method);
    expect(methods).toContain("update");
    expect(methods).not.toContain("upsert");
    expect(methods).not.toContain("insert");
    // By the company's id, so any owner or company.profile role saves it (RP-REQ-002).
    expect(saveCall().chain).toContainEqual({ method: "eq", args: ["id", COMPANY_A.id] });
    expect(saveCall().chain).not.toContainEqual({ method: "eq", args: ["user_id", COMPANY_A.user.id] });
    expect(markMyOnboardingComplete).toHaveBeenCalledWith("company");
  });

  it("sends no billing column and no user_id in the payload", async () => {
    vi.mocked(markMyOnboardingComplete).mockResolvedValue({ error: null });
    await renderLoaded();
    supabase().queue("company_info", { data: { id: COMPANY_A.id }, error: null });

    submit();

    await waitFor(() => expect(router.push).toHaveBeenCalled());
    const payload = saveCall().chain.find((c) => c.method === "update")!.args[0] as Record<string, unknown>;
    for (const column of [...BILLING_COLUMNS, "user_id"]) {
      expect(payload).not.toHaveProperty(column);
    }
    expect(payload).toMatchObject({ name: "Acme", filled: true });
  });

  it("toasts on a DB error and doesn't mark onboarding complete", async () => {
    await renderLoaded();
    supabase().queue("company_info", { data: null, error: { message: "denied" } });

    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(markMyOnboardingComplete).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("treats an update that matched no row as an error", async () => {
    await renderLoaded();
    supabase().queue("company_info", { data: null, error: null });

    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(markMyOnboardingComplete).not.toHaveBeenCalled();
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
