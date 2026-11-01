import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MergedNotice from "./MergedNotice";

const IMPORTED = "ea000000-0000-4000-8000-000000000001";
const DIRECT = "ea000000-0000-4000-8000-000000000002";

describe("MergedNotice (BIT-065, BI-REQ-042)", () => {
  it("links the direct application to the import merged into it", () => {
    render(<MergedNotice mergedInto={null} mergedFrom={[IMPORTED]} />);

    expect(screen.getByRole("note")).toHaveTextContent("Merged from an import");
    expect(screen.getByRole("link", { name: "see its notes, activity and screening" })).toHaveAttribute(
      "href",
      `/company/applications/${IMPORTED}/notes`,
    );
  });

  it("marks the merged import read-only and links where it went", () => {
    render(<MergedNotice mergedInto={DIRECT} mergedFrom={[]} />);

    expect(screen.getByRole("note")).toHaveTextContent("It's kept read-only.");
    expect(screen.getByRole("link", { name: "Open their application" })).toHaveAttribute(
      "href",
      `/company/applications/${DIRECT}`,
    );
  });

  it("shows nothing without a merge", () => {
    const { container } = render(<MergedNotice mergedInto={null} mergedFrom={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
