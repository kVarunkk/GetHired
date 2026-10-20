import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import ScrollMaskX from "./ScrollMaskX";

// jsdom has no layout and drops mask-image from inline styles, so the fade
// state is checked through the data attributes.

/** Gives the scroller its sizes by hand. */
function setSizes(
  scroller: HTMLElement,
  {
    scrollWidth,
    clientWidth,
    scrollLeft,
  }: { scrollWidth: number; clientWidth: number; scrollLeft: number },
) {
  Object.defineProperty(scroller, "scrollWidth", {
    configurable: true,
    value: scrollWidth,
  });
  Object.defineProperty(scroller, "clientWidth", {
    configurable: true,
    value: clientWidth,
  });
  scroller.scrollLeft = scrollLeft;
  fireEvent.scroll(scroller);
}

function setup() {
  const { getByText } = render(
    <ScrollMaskX>
      <p>Tabs</p>
    </ScrollMaskX>,
  );
  return getByText("Tabs").parentElement!;
}

describe("ScrollMaskX", () => {
  it("doesn't mask a row that fits", () => {
    const scroller = setup();

    setSizes(scroller, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });

    expect(scroller).toHaveAttribute("data-fade-left", "false");
    expect(scroller).toHaveAttribute("data-fade-right", "false");
  });

  it("fades only the right edge at the start of a long row", () => {
    const scroller = setup();

    setSizes(scroller, { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });

    expect(scroller).toHaveAttribute("data-fade-left", "false");
    expect(scroller).toHaveAttribute("data-fade-right", "true");
  });

  it("fades both edges in the middle, and only the left at the end", () => {
    const scroller = setup();

    setSizes(scroller, { scrollWidth: 600, clientWidth: 300, scrollLeft: 150 });
    expect(scroller).toHaveAttribute("data-fade-left", "true");
    expect(scroller).toHaveAttribute("data-fade-right", "true");

    setSizes(scroller, { scrollWidth: 600, clientWidth: 300, scrollLeft: 300 });
    expect(scroller).toHaveAttribute("data-fade-left", "true");
    expect(scroller).toHaveAttribute("data-fade-right", "false");
  });

  it("hides the scrollbar but still scrolls", () => {
    expect(setup()).toHaveClass("overflow-x-auto", "scrollbar-none");
  });
});
