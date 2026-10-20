import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { IJobPost } from "@/utils/types";
import { JobStatusSwitch } from "./JobPostingsTable";

const handleUpdateStatus = vi.fn();
vi.mock("@/hooks/useJobPostingStatus", () => ({
  useJobPostingStatus: () => ({ checkedState: true, handleUpdateStatus, upgradeDialog: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("react-transition-progress/next", () => ({ Link: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const job = { id: "b0000000-0000-4000-8000-000000000001", status: "active" } as unknown as IJobPost;

describe("JobStatusSwitch (TM-REQ-004)", () => {
  it("is disabled for a member and keeps showing the status", () => {
    render(<JobStatusSwitch job={job} disabled />);

    const toggle = screen.getByRole("switch", { name: "Job is active" });
    expect(toggle).toBeDisabled();
    expect(toggle).toBeChecked();
  });

  it("is enabled for owners and admins", () => {
    render(<JobStatusSwitch job={job} />);

    expect(screen.getByRole("switch")).toBeEnabled();
  });
});
