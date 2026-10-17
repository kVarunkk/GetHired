import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { sendSignupEmail } from "@/app/actions/sign-up-email";
import { acceptInviteAction } from "@/app/actions/team/accept-invite";
import JoinCompany, { type JoinInvite } from "./JoinCompany";

vi.mock("@/app/actions/sign-up-email", () => ({ sendSignupEmail: vi.fn() }));
vi.mock("@/app/actions/team/accept-invite", () => ({ acceptInviteAction: vi.fn() }));

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }));

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const TOKEN = "tok_abcdefghijklmnopqrstuvwxyz0123456789";
const INVITE: JoinInvite = {
  companyName: "Acme",
  inviterName: "Olive Owner",
  roleName: "Member",
  email: "priya@gmail.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
});

describe("JoinCompany (TMT-041)", () => {
  it("shows only the invalid message for an unknown, expired or used token", () => {
    render(<JoinCompany state="invalid" token="" />);

    expect(screen.getByText("This invite link isn't valid any more. Ask for a new one.")).toBeInTheDocument();
    expect(screen.queryByText(/Acme/)).not.toBeInTheDocument();
  });

  it("shows the company, the inviter and the role", () => {
    render(<JoinCompany state="ready" token={TOKEN} invite={INVITE} />);

    expect(screen.getByRole("heading", { name: "Join Acme" })).toBeInTheDocument();
    expect(
      screen.getByText(/Olive Owner invited you to join Acme's hiring team on GetHired with the Member role/),
    ).toBeInTheDocument();
  });

  it("says when the invite's role was removed and they'll join with the default role (RP-REQ-007)", () => {
    render(<JoinCompany state="ready" token={TOKEN} invite={{ ...INVITE, roleFellBack: true }} />);

    expect(screen.getByText(/has since been removed, so you'll join as Member/)).toBeInTheDocument();
  });

  describe("signed out", () => {
    it("offers sign-up with the invited email read-only, a name field and no Google button (TM-CON-003)", () => {
      render(<JoinCompany state="signed_out" token={TOKEN} invite={INVITE} />);

      const email = screen.getByLabelText("Email");
      expect(email).toHaveValue("priya@gmail.com");
      expect(email).toHaveAttribute("readonly");
      expect(screen.getByLabelText("Your name")).toBeInTheDocument();
      expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
    });

    it("signs up in invite mode with the token and the name", async () => {
      vi.mocked(sendSignupEmail).mockResolvedValue({ success: true, message: "ok" });
      render(<JoinCompany state="signed_out" token={TOKEN} invite={INVITE} />);

      fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Priya" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
      fireEvent.change(screen.getByLabelText("Repeat password"), { target: { value: "secret123" } });
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));

      await waitFor(() => expect(screen.getByText(/for a confirmation link/)).toBeInTheDocument());
      expect(sendSignupEmail).toHaveBeenCalledWith("priya@gmail.com", "secret123", true, {
        inviteToken: TOKEN,
        fullName: "Priya",
      });
    });

    it("signs in as the invited email and reloads the page", async () => {
      render(<JoinCompany state="signed_out" token={TOKEN} invite={INVITE} />);

      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "priya@gmail.com", password: "secret123" });
    });
  });

  it("joins with the invited email, then goes to /company", async () => {
    vi.mocked(acceptInviteAction).mockResolvedValue({ ok: true, roleName: "Member", fellBack: false });
    render(<JoinCompany state="ready" token={TOKEN} invite={INVITE} />);

    fireEvent.click(screen.getByRole("button", { name: "Join Acme" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/company"));
    expect(acceptInviteAction).toHaveBeenCalledWith({ token: TOKEN });
  });

  it("shows the action's error and stays", async () => {
    vi.mocked(acceptInviteAction).mockResolvedValue({ ok: false, error: "Your plan's seats are all in use." });
    render(<JoinCompany state="ready" token={TOKEN} invite={INVITE} />);

    fireEvent.click(screen.getByRole("button", { name: "Join Acme" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your plan's seats are all in use.");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("explains a different signed-in email and offers sign-out", async () => {
    render(<JoinCompany state="wrong_email" token={TOKEN} invite={INVITE} signedInEmail="hr@other.com" />);

    expect(screen.getByText("hr@other.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
  });

  it("shows the TM-REQ-003 message to a candidate account", () => {
    render(<JoinCompany state="applicant" token={TOKEN} invite={INVITE} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This email already has a GetHired candidate account (signing in with Google creates one). Ask for an invite to a different email, such as your work email.",
    );
    expect(screen.queryByRole("button", { name: /Join/ })).not.toBeInTheDocument();
  });
});
