import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ApplicationStatusBadge from "./ApplicationStatusBadge";
import { TApplicationStatus } from "@/utils/types";

describe("ApplicationStatusBadge", () => {
  it("renders the status with its colour", () => {
    render(<ApplicationStatusBadge status={TApplicationStatus.SELECTED} />);

    const badge = screen.getByText("selected");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("bg-green-500");
  });

  it("uses the red style for rejected applications", () => {
    render(<ApplicationStatusBadge status={TApplicationStatus.REJECTED} />);

    expect(screen.getByText("rejected")).toHaveClass("bg-red-500");
  });
});
