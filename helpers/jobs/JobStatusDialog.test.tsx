import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { trackExternalApplicationAction } from "@/app/actions/applications/track-external-application";
import JobStatusDialog from "./JobStatusDialog";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));
vi.mock("@/app/actions/applications/track-external-application", () => ({
  trackExternalApplicationAction: vi.fn(),
}));
vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const JOB = { id: "j1", job_name: "Frontend Engineer", company_name: "Acme" } as never;
const track = vi.mocked(trackExternalApplicationAction);

beforeEach(() => {
  vi.clearAllMocks();
  track.mockResolvedValue({ ok: true });
  vi.mocked(useRouter).mockReturnValue({ push: vi.fn() } as never);
});

const renderDialog = (onClose = vi.fn()) => {
  render(<JobStatusDialog job={JOB} showDialog onClose={onClose} />);
  return onClose;
};

describe("JobStatusDialog", () => {
  it("asks only yes or no first, without agent links to distract", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Agent suggestions" })).not.toBeInTheDocument();
  });

  it("closes on No without tracking", () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onClose).toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("tracks on Yes, then offers the agent with the job in each prompt", async () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    expect(await screen.findByText("Application tracked")).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith({ allJobsId: "j1" });
    expect(onClose).not.toHaveBeenCalled();

    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = decodeURIComponent(link.getAttribute("href") ?? "");
      expect(href).toContain("Frontend Engineer role at Acme (/jobs/j1)");
    }

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
