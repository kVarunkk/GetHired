import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import ScrollFadeX from "./ScrollFadeX";

// jsdom doesn't lay out, so the sizes are set by hand.
function setup(fadeStart?: boolean) {
  const { container } = render(
    <ScrollFadeX fadeStart={fadeStart}>
      <table />
    </ScrollFadeX>,
  );
  const scroller = container.firstElementChild as HTMLDivElement;
  Object.defineProperty(scroller, "scrollWidth", { value: 600 });
  Object.defineProperty(scroller, "clientWidth", { value: 300 });
  const scrollTo = (left: number) => {
    scroller.scrollLeft = left;
    fireEvent.scroll(scroller);
  };
  const faded = () => [scroller.dataset.fadeStart, scroller.dataset.fadeEnd];
  return { scrollTo, faded };
}

describe("ScrollFadeX", () => {
  it("fades each side that has more to scroll to", () => {
    const { scrollTo, faded } = setup();
    scrollTo(0);
    expect(faded()).toEqual(["false", "true"]);
    scrollTo(150);
    expect(faded()).toEqual(["true", "true"]);
    scrollTo(300);
    expect(faded()).toEqual(["true", "false"]);
  });

  it("leaves the left edge alone for a sticky first column", () => {
    const { scrollTo, faded } = setup(false);
    scrollTo(150);
    expect(faded()).toEqual(["false", "true"]);
  });
});
