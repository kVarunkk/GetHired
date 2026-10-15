import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { stageOf } from "@/test/utils/pipeline";
import FunnelStrip from "./FunnelStrip";

const stage = (
  kind: Parameters<typeof stageOf>[0],
  extra: { count: number; conversion: number | null; medianDays: number | null },
) => ({
  stageId: stageOf(kind).id,
  name: stageOf(kind).name,
  kind,
  ...extra,
});

describe("FunnelStrip (PLT-082)", () => {
  it("shows each stage's count, conversion and median days", () => {
    render(
      <FunnelStrip
        stages={[
          stage("applied", { count: 2, conversion: null, medianDays: 4 }),
          stage("screening", { count: 2, conversion: 0.6, medianDays: 2.5 }),
          stage("offer", { count: 0, conversion: null, medianDays: null }),
        ]}
      />,
    );

    const items = within(screen.getByRole("list", { name: "Pipeline funnel" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Applied24d median",
      "Screening260% reached · 2.5d median",
      "Offer0",
    ]);
  });

  it("renders nothing without stages", () => {
    const { container } = render(<FunnelStrip stages={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
