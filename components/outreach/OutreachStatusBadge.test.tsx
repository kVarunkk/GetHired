import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OUTREACH_STATUSES } from "@/helpers/outreach/config";
import OutreachStatusBadge, { OUTREACH_STATUS_LABELS } from "./OutreachStatusBadge";

describe("OutreachStatusBadge (ORT-031)", () => {
  it.each(OUTREACH_STATUSES)("shows one label for %s", (status) => {
    render(<OutreachStatusBadge status={status} />);
    expect(screen.getByText(OUTREACH_STATUS_LABELS[status].label)).toHaveAttribute("data-status", status);
  });

  it("uses theme variants, not palette colours", () => {
    for (const status of OUTREACH_STATUSES) {
      expect(["brand", "success", "warning", "outline", "secondary"]).toContain(OUTREACH_STATUS_LABELS[status].variant);
    }
    const { container } = render(<OutreachStatusBadge status="interested" />);
    expect(container.innerHTML).not.toMatch(/(?:bg|text)-(?:green|red|blue|gray)-\d/);
  });

  it("renders nothing without an outreach", () => {
    const { container } = render(<OutreachStatusBadge status={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
