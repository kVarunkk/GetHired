import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { claimCandidateAction } from "@/app/actions/candidates/claim-candidate";
import ClaimCandidate from "./ClaimCandidate";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/actions/candidates/claim-candidate", () => ({ claimCandidateAction: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("ClaimCandidate (BIT-064, BI-REQ-041)", () => {
  it("claims and goes to the interview", async () => {
    vi.mocked(claimCandidateAction).mockResolvedValue({ ok: true, href: "/interview/screening/ai1", offerPrefill: false });
    render(<ClaimCandidate token="tok" companyName="Acme" />);

    await userEvent.click(screen.getByRole("button", { name: "Continue to the interview" }));

    expect(claimCandidateAction).toHaveBeenCalledWith({ token: "tok" });
    expect(push).toHaveBeenCalledWith("/interview/screening/ai1");
  });

  it("shows the reason and stays put when the claim is refused", async () => {
    vi.mocked(claimCandidateAction).mockResolvedValue({ ok: false, error: "This link has expired." });
    render(<ClaimCandidate token="tok" companyName="Acme" />);

    await userEvent.click(screen.getByRole("button", { name: "Continue to the interview" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This link has expired.");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("offers the company's resume to an account without a profile, without leaving yet (BIT-105)", async () => {
    vi.mocked(claimCandidateAction).mockResolvedValue({ ok: true, href: "/interview/screening/ai1", offerPrefill: true });
    render(<ClaimCandidate token="tok" companyName="Acme" />);

    await userEvent.click(screen.getByRole("button", { name: "Continue to the interview" }));

    expect(await screen.findByText("Acme has a resume on file for you. Use it to start your profile?")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Review my profile" })).toHaveAttribute(
      "href",
      `/get-started?claim=tok&returnTo=${encodeURIComponent("/interview/screening/ai1")}`,
    );
    expect(screen.getByRole("link", { name: "Skip for now" })).toHaveAttribute("href", "/interview/screening/ai1");
  });
});
