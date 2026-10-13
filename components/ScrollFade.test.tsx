import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import ScrollFade from "./ScrollFade";

/** jsdom has no layout, so give the scroller its sizes by hand. */
function setSizes(
  scroller: HTMLElement,
  {
    scrollHeight,
    clientHeight,
    scrollTop,
  }: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  scroller.scrollTop = scrollTop;
  fireEvent.scroll(scroller);
}

function setup() {
  const { container, getByText } = render(
    <ScrollFade className="flex-1">
      <p>Item</p>
    </ScrollFade>,
  );
  const scroller = getByText("Item").parentElement!.parentElement!;
  const edge = (which: "top" | "bottom") =>
    container
      .querySelector(`[data-edge="${which}"]`)!
      .getAttribute("data-visible");
  return { scroller, edge };
}

describe("ScrollFade", () => {
  it("shows no fades when everything fits", () => {
    const { scroller, edge } = setup();

    setSizes(scroller, { scrollHeight: 200, clientHeight: 200, scrollTop: 0 });

    expect(edge("top")).toBe("false");
    expect(edge("bottom")).toBe("false");
  });

  it("shows the bottom fade at the top of a long list", () => {
    const { scroller, edge } = setup();

    setSizes(scroller, { scrollHeight: 500, clientHeight: 200, scrollTop: 0 });

    expect(edge("top")).toBe("false");
    expect(edge("bottom")).toBe("true");
  });

  it("shows both fades in the middle", () => {
    const { scroller, edge } = setup();

    setSizes(scroller, {
      scrollHeight: 500,
      clientHeight: 200,
      scrollTop: 100,
    });

    expect(edge("top")).toBe("true");
    expect(edge("bottom")).toBe("true");
  });

  it("shows only the top fade at the end", () => {
    const { scroller, edge } = setup();

    setSizes(scroller, {
      scrollHeight: 500,
      clientHeight: 200,
      scrollTop: 300,
    });

    expect(edge("top")).toBe("true");
    expect(edge("bottom")).toBe("false");
  });

  it("hides its scrollbar but still scrolls", () => {
    const { scroller } = setup();

    expect(scroller).toHaveClass("overflow-y-auto", "scrollbar-none");
  });
});
