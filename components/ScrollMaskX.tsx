"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/utils";

/** Distance from an edge, in px, that still counts as being at it. */
const EDGE_PX = 1;
/** Width of each fade. */
const FADE_PX = 24;

/**
 * A horizontally scrolling row with no scrollbar. Each edge that has more
 * content beyond it fades out through a mask, so it's clear there's more to
 * scroll to. A mask (not an overlay like ScrollFade's) fades whatever is
 * underneath, such as the tabs' grey pill. On mount, the element matching
 * `revealSelector` is scrolled into view.
 */
export default function ScrollMaskX({
  children,
  className,
  revealSelector,
}: {
  children: React.ReactNode;
  className?: string;
  /** An element inside to bring into view on mount, e.g. the active tab. */
  revealSelector?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const left = scroller.scrollLeft > EDGE_PX;
    const right =
      scroller.scrollWidth - scroller.scrollLeft - scroller.clientWidth >
      EDGE_PX;
    setEdges((current) =>
      current.left === left && current.right === right
        ? current
        : { left, right },
    );
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller && revealSelector) {
      const target = scroller.querySelector<HTMLElement>(revealSelector);
      // Scroll only this row, never the page. The scroller is `relative`, so
      // it's the target's offsetParent.
      if (target) {
        const start = target.offsetLeft;
        const end = start + target.offsetWidth;
        if (
          end > scroller.scrollLeft + scroller.clientWidth - FADE_PX ||
          start < scroller.scrollLeft
        ) {
          scroller.scrollLeft = start - FADE_PX;
        }
      }
    }
    update();
    if (typeof ResizeObserver === "undefined" || !scroller) return;
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    for (const child of Array.from(scroller.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [update, revealSelector]);

  const mask = `linear-gradient(to right, ${edges.left ? "transparent" : "#000"}, #000 ${FADE_PX}px, #000 calc(100% - ${FADE_PX}px), ${edges.right ? "transparent" : "#000"})`;

  return (
    <div
      ref={scrollerRef}
      onScroll={update}
      data-fade-left={edges.left}
      data-fade-right={edges.right}
      className={cn(
        "relative min-w-0 max-w-full overflow-x-auto overflow-y-hidden scrollbar-none",
        className,
      )}
      style={
        edges.left || edges.right
          ? { maskImage: mask, WebkitMaskImage: mask }
          : undefined
      }
    >
      {children}
    </div>
  );
}
