import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ChannelStatsTable from "./ChannelStatsTable";

describe("ChannelStatsTable", () => {
  it("shows a row per source with named channels", () => {
    render(
      <ChannelStatsTable
        names={{ jooble: "Jooble" }}
        stats={[
          { channel: "jooble", applies: 3, progressed: 1, hired: 1, rejected: 0 },
          { channel: "gethired", applies: 2, progressed: 0, hired: 0, rejected: 0 },
        ]}
      />,
    );
    expect(screen.getByText("Jooble")).toBeInTheDocument();
    expect(screen.getByText("GetHired")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
  it("shows the empty message", () => {
    render(<ChannelStatsTable names={{}} stats={[]} />);
    expect(screen.getByText("No applications yet.")).toBeInTheDocument();
  });
});
