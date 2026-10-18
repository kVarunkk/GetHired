import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CareersShell from "./CareersShell";

const NAVBAR_GUTTER = ["px-4", "lg:px-20", "xl:px-40", "2xl:px-80"];

describe("CareersShell", () => {
  it("lines the content and footer up with the public navbar, without a narrow max width", () => {
    const { container, getByText } = render(
      <CareersShell page={{ accentColor: null }}>
        <p>Content</p>
      </CareersShell>,
    );
    const content = getByText("Content").parentElement!;
    const footer = container.querySelector("footer")!;
    for (const el of [content, footer]) {
      expect(el).toHaveClass(...NAVBAR_GUTTER);
      expect(el.className).not.toContain("max-w-");
    }
  });

  it("uses a container-sized gutter inside the editor preview", () => {
    const { getByText } = render(
      <CareersShell page={{ accentColor: null }} embedded>
        <p>Content</p>
      </CareersShell>,
    );
    const content = getByText("Content").parentElement!;
    expect(content).toHaveClass("px-4", "sm:px-6");
    expect(content).not.toHaveClass("lg:px-20");
  });
});
