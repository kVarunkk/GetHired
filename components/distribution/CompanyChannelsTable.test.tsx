import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setChannelEnabledAction } from "@/app/actions/distribution/channel-actions";
import type { CompanyChannel } from "@/helpers/distribution/load-job-distribution";
import CompanyChannelsTable from "./CompanyChannelsTable";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/distribution/channel-actions", () => ({ setChannelEnabledAction: vi.fn() }));

const CHANNELS: CompanyChannel[] = [
  { key: "google", name: "Google for Jobs", kind: "index", state: "always_on", canToggle: false },
  { key: "jooble", name: "Jooble", kind: "feed", state: "waiting_for_approval", canToggle: true },
  { key: "adzuna", name: "Adzuna", kind: "feed", state: "off", canToggle: true },
];

beforeEach(() => {
  vi.mocked(setChannelEnabledAction).mockReset();
  refresh.mockReset();
});

describe("CompanyChannelsTable (MP-REQ-011)", () => {
  it("shows each channel's company-wide state and switch", () => {
    render(<CompanyChannelsTable channels={CHANNELS} canManage />);
    expect(screen.getAllByText("Always on")).not.toHaveLength(0);
    expect(screen.getByText("On, waiting for the board")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Jooble active" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Adzuna active" })).not.toBeChecked();
    expect(screen.queryByRole("switch", { name: "Google for Jobs active" })).not.toBeInTheDocument();
  });

  it("turns a channel on for every job", async () => {
    vi.mocked(setChannelEnabledAction).mockResolvedValue({ ok: true });
    render(<CompanyChannelsTable channels={CHANNELS} canManage />);
    fireEvent.click(screen.getByRole("switch", { name: "Adzuna active" }));
    await waitFor(() => expect(setChannelEnabledAction).toHaveBeenCalledWith({ channelKey: "adzuna", enabled: true }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("disables the switches without company-wide distribution.manage", () => {
    render(<CompanyChannelsTable channels={CHANNELS} />);
    expect(screen.getByRole("switch", { name: "Adzuna active" })).toBeDisabled();
  });
});
