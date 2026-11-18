import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { setJobChannelOptOutAction } from "@/app/actions/distribution/channel-actions";
import type { ChannelRow } from "@/helpers/distribution/channel-status";
import DistributionTable from "./DistributionTable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/distribution/channel-actions", () => ({
  setJobChannelOptOutAction: vi.fn(),
}));

describe("DistributionTable", () => {
  it("shows each channel with its status and reasons", () => {
    render(
      <DistributionTable
        rows={[
          { key: "google", name: "Google for Jobs", kind: "index", state: "live", reasons: [] },
          { key: "jooble", name: "Jooble", kind: "feed", state: "pending_approval", reasons: ["In the feed. Jooble hasn't approved GetHired yet"] },
          { key: "adzuna", name: "Adzuna", kind: "feed", state: "not_live", reasons: ["Missing location", "Missing apply link"] },
        ]}
      />,
    );
    expect(screen.getByText("Google for Jobs")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the board")).toBeInTheDocument();
    expect(screen.getByText("In the feed. Jooble hasn't approved GetHired yet")).toBeInTheDocument();
    expect(screen.getByText("Missing location")).toBeInTheDocument();
    expect(screen.getByText("Missing apply link")).toBeInTheDocument();
  });

  it("shows the empty message with no channels", () => {
    render(<DistributionTable rows={[]} />);
    expect(screen.getByText("No channels are available yet.")).toBeInTheDocument();
  });
});

describe("DistributionTable: Post this job (MP-REQ-011)", () => {
  const feed = (state: ChannelRow["state"]): ChannelRow => ({ key: "jooble", name: "Jooble", kind: "feed", state, reasons: [] });

  beforeEach(() => vi.mocked(setJobChannelOptOutAction).mockReset());

  it("has no company-wide switch, and points an off channel to Settings", () => {
    render(<DistributionTable rows={[feed("off")]} jobId="j1" canManage />);
    expect(screen.queryByRole("button", { name: /turn (on|off)/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Off in Settings" })).toHaveAttribute("href", "/company/settings/distribution");
  });

  it("shows Yes for an included job and No for an opted-out one", () => {
    render(<DistributionTable rows={[feed("live"), { ...feed("opted_out"), key: "adzuna", name: "Adzuna" }]} jobId="j1" canManage />);
    const jooble = screen.getByRole("radiogroup", { name: "Post this job on Jooble" });
    expect(within(jooble).getByRole("radio", { name: "Yes" })).toBeChecked();
    const adzuna = screen.getByRole("radiogroup", { name: "Post this job on Adzuna" });
    expect(within(adzuna).getByRole("radio", { name: "No" })).toBeChecked();
  });

  it("opts the job out when No is picked", async () => {
    vi.mocked(setJobChannelOptOutAction).mockResolvedValue({ ok: true });
    render(<DistributionTable rows={[feed("live")]} jobId="j1" canManage />);
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    await waitFor(() =>
      expect(setJobChannelOptOutAction).toHaveBeenCalledWith({ jobId: "j1", channelKey: "jooble", optedOut: true }),
    );
  });

  it("disables the choice without distribution.manage on the job", () => {
    render(<DistributionTable rows={[feed("live")]} jobId="j1" />);
    expect(screen.getByRole("radio", { name: "Yes" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "No" })).toBeDisabled();
  });

  it("marks search engines as always on", () => {
    render(
      <DistributionTable rows={[{ key: "google", name: "Google for Jobs", kind: "index", state: "live", reasons: [] }]} jobId="j1" canManage />,
    );
    expect(screen.getByText("Always")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });
});
