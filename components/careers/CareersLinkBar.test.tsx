import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { copyToClipboard } from "@/utils/utils";
import CareersLinkBar from "./CareersLinkBar";
import ShareJobPosting from "../ShareJobPosting";

vi.mock("@/utils/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/utils")>()),
  copyToClipboard: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("CareersLinkBar (CP-REQ-014)", () => {
  it("links to and copies a published page", () => {
    render(<CareersLinkBar slug="acme" published />);
    expect(screen.getByRole("link", { name: "gethired.devhub.co.in/careers/acme" })).toHaveAttribute("href", "/careers/acme");
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(copyToClipboard).toHaveBeenCalledWith("https://gethired.devhub.co.in/careers/acme", "Careers link copied.");
  });

  it("points an unpublished page to the editor", () => {
    render(<CareersLinkBar slug="acme" published={false} />);
    expect(screen.getByText("Not published yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set it up" })).toHaveAttribute("href", "/company/settings/careers");
    expect(screen.queryByRole("button", { name: "Copy link" })).not.toBeInTheDocument();
  });
});

describe("ShareJobPosting with a careers page (CP-REQ-014)", () => {
  it("copies the job board link directly without a careers page", () => {
    render(<ShareJobPosting job_id="d1" />);
    fireEvent.click(screen.getByRole("button", { name: "Share Job Post" }));
    expect(copyToClipboard).toHaveBeenCalledWith(`${window.location.origin}/jobs/d1`, "Job link copied to clipboard!");
  });

  it("offers the careers page link too", async () => {
    render(<ShareJobPosting job_id="d1" careersSlug="acme" />);
    await userEvent.click(screen.getByRole("button", { name: "Share Job Post" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy careers page link" }));
    expect(copyToClipboard).toHaveBeenCalledWith(
      `${window.location.origin}/careers/acme/jobs/d1`,
      "Careers page link copied to clipboard!",
    );
  });
});
