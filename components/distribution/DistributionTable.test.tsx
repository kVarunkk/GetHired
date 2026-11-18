import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DistributionTable from "./DistributionTable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/distribution/channel-actions", () => ({
  setChannelEnabledAction: vi.fn(),
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

describe("DistributionTable controls", () => {
  const rows = [{ key: "jooble", name: "Jooble", kind: "feed" as const, state: "off" as const, reasons: ["Not turned on for your company"] }];
  it("hides controls without distribution.manage", () => {
    render(<DistributionTable rows={rows} jobId="j1" />);
    expect(screen.queryByRole("button", { name: "Turn on" })).not.toBeInTheDocument();
  });
  it("offers Turn on to a company-wide manager", () => {
    render(<DistributionTable rows={rows} jobId="j1" canManage canManageAll />);
    expect(screen.getByRole("button", { name: "Turn on" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave this job out" })).not.toBeInTheDocument();
  });
});
