import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "@supabase/supabase-js";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import NavbarComponent from "./Navbar";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("./FeedbackForm", () => ({ default: () => <button>Feedback</button> }));
vi.mock("./ProfileDropdown", () => ({ default: () => <button>Profile</button> }));
vi.mock("./auth-button", () => ({ AuthButton: () => <a href="/auth/login">Sign in</a> }));
vi.mock("./SocialsComponent", () => ({ default: () => null }));
vi.mock("./WaitlistCTA", () => ({ default: () => null }));
vi.mock("./ModifiedLink", () => ({
  default: ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

const applicant = { id: "u1", app_metadata: { type: "applicant" }, user_metadata: {} } as unknown as User;

/** Captures the auth listener so a test can report the browser's session. */
let reportSession: (user: User | null) => void;

beforeEach(() => {
  vi.mocked(usePathname).mockReturnValue("/");
  vi.mocked(createClient).mockReturnValue({
    auth: {
      onAuthStateChange: (callback: (event: string, session: { user: User } | null) => void) => {
        reportSession = (user) => callback("INITIAL_SESSION", user ? { user } : null);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  } as never);
});

const renderNavbar = (initialUser: User | null) =>
  render(
    <TooltipProvider>
      <NavbarComponent variant="horizontal" initialUser={initialUser} />
    </TooltipProvider>,
  );

describe("NavbarComponent: auth state on statically rendered pages", () => {
  it("shows neither signed-in nor signed-out controls until the session is known", () => {
    renderNavbar(null);

    expect(screen.queryByText("Sign in")).not.toBeInTheDocument();
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Jobs" })).not.toBeInTheDocument();
  });

  it("then shows the signed-in controls without flashing sign-in first", () => {
    renderNavbar(null);
    act(() => reportSession(applicant));

    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.queryByText("Sign in")).not.toBeInTheDocument();
  });

  it("shows sign-in once the visitor is confirmed signed out", () => {
    renderNavbar(null);
    act(() => reportSession(null));

    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });

  it("trusts a user the server already knew about", () => {
    renderNavbar(applicant);

    expect(screen.getByText("Profile")).toBeInTheDocument();
  });
});

describe("NavbarComponent: navigation skeletons", () => {
  const loadingRegions = () => screen.queryAllByRole("status", { name: "Loading navigation" });

  it("shows skeletons for the horizontal links and menu button until the session is known", () => {
    renderNavbar(null);

    // Desktop link row and the mobile menu button.
    expect(loadingRegions()).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Open menu" })).not.toBeInTheDocument();

    act(() => reportSession(applicant));
    expect(loadingRegions()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });

  it("shows a skeleton for the sidebar items too", () => {
    render(
      <TooltipProvider>
        <NavbarComponent variant="vertical" initialUser={null} />
      </TooltipProvider>,
    );

    // Horizontal link row, menu button, and the sidebar list.
    expect(loadingRegions()).toHaveLength(3);

    act(() => reportSession(applicant));
    expect(loadingRegions()).toHaveLength(0);
  });

  it("skips skeletons when the server already knew the user", () => {
    renderNavbar(applicant);

    expect(loadingRegions()).toHaveLength(0);
  });
});

describe("NavbarComponent: horizontal links", () => {
  it("leaves Dashboard out of the desktop links but keeps it in the mobile menu", async () => {
    renderNavbar(applicant);

    const desktopLinks = screen.getByRole("navigation", { name: "Main" });
    expect(within(desktopLinks).getByRole("link", { name: "Jobs" })).toBeInTheDocument();
    expect(within(desktopLinks).queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("swaps to the short logo on very small screens instead of scrolling sideways", () => {
    renderNavbar(applicant);

    const home = screen.getByRole("link", { name: "GetHired home" });
    const [short, long] = Array.from(home.children);
    expect(short).toHaveClass("min-[400px]:hidden");
    expect(long).toHaveClass("hidden", "min-[400px]:block");
  });
});

describe("NavbarComponent: open outreach badge (ORT-034)", () => {
  function withOpenOutreach(count: number) {
    const eq = vi.fn();
    const chain = { select: vi.fn(() => chain), eq: vi.fn((...args: unknown[]) => (eq(...args), chain)), gt: vi.fn(() => Promise.resolve({ count, error: null })) };
    vi.mocked(createClient).mockReturnValue({
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
      from: vi.fn(() => chain),
    } as never);
    return eq;
  }

  it("shows the applicant's open outreach count next to Opportunities", async () => {
    const eq = withOpenOutreach(2);
    vi.mocked(usePathname).mockReturnValue("/jobs");

    renderNavbar(applicant);

    expect((await screen.findAllByLabelText("2 open")).length).toBeGreaterThan(0);
    expect(eq).toHaveBeenCalledWith("candidate_user_id", "u1");
    expect(eq).toHaveBeenCalledWith("status", "sent");
  });

  it("shows nothing at 0", async () => {
    withOpenOutreach(0);
    vi.mocked(usePathname).mockReturnValue("/jobs");

    renderNavbar(applicant);

    await waitFor(() => expect(screen.getAllByText("Opportunities").length).toBeGreaterThan(0));
    expect(screen.queryByLabelText(/open$/)).not.toBeInTheDocument();
  });

  it("never queries outreach for a company user", () => {
    withOpenOutreach(3);
    const company = { id: "c1", app_metadata: { type: "company" }, user_metadata: {} } as unknown as User;
    vi.mocked(usePathname).mockReturnValue("/company");

    renderNavbar(company);

    expect(vi.mocked(createClient).mock.results.some((r) => (r.value as { from: ReturnType<typeof vi.fn> }).from.mock.calls.length > 0)).toBe(false);
  });
});
