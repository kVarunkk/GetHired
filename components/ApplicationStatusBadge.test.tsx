import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ApplicationStatusBadge from "./ApplicationStatusBadge";
import { TApplicationStatus } from "@/utils/types";

describe("ApplicationStatusBadge", () => {
  it("renders the status with its colour", () => {
    render(<ApplicationStatusBadge status={TApplicationStatus.SELECTED} />);

    const badge = screen.getByText("selected");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("text-success");
  });

  it("uses the destructive style for rejected applications", () => {
    render(<ApplicationStatusBadge status={TApplicationStatus.REJECTED} />);

    expect(screen.getByText("rejected")).toHaveClass("text-destructive");
  });
});
