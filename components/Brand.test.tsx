import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Brand from "./Brand";

describe("Brand", () => {
  it("uses the default responsive size and centres the logo", () => {
    const { container } = render(<Brand type="long" />);

    expect(container.firstChild).toHaveClass("w-[100px]");
    for (const img of screen.getAllByAltText("GetHired logo")) {
      expect(img).toHaveClass("object-contain");
      expect(img).not.toHaveClass("object-left");
    }
  });

  it("takes a custom size and pins the logo to the left edge", () => {
    const { container } = render(<Brand type="long" className="h-12 w-[140px]" />);

    expect(container.firstChild).toHaveClass("h-12", "w-[140px]");
    expect(container.firstChild).not.toHaveClass("w-[100px]");
    for (const img of screen.getAllByAltText("GetHired logo")) {
      expect(img).toHaveClass("object-left");
    }
  });
});
