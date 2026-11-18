"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/utils";

/** Distance from an edge, in px, that still counts as being at it. */
const EDGE_PX = 1;

/**
 * A vertically scrolling area with no scrollbar. A fade and a hairline show
 * at each edge that has more content beyond it, so it's clear there's
 * something left to scroll to.
 */
export default function ScrollFade({
  children,
  className,
  contentClassName,
  scrollerClassName,
  revealSelector,
  revealKey,
}: {
  /** An element inside to keep in view, e.g. the active nav item. */
  revealSelector?: string;
  /** Changes when the element to reveal changes (e.g. the pathname). */
  revealKey?: string;
  children: React.ReactNode;
  /** Classes for the outer box; give it a height (e.g. `flex-1 min-h-0`). */
  className?: string;
  /** Classes for the wrapper around the children. */
  contentClassName?: string;
  /**
   * Classes for the scrolling box. Use it to size the area by its content up
   * to a cap (`h-auto max-h-…`) when the outer box has no definite height.
   */
  scrollerClassName?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const update = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const top = scroller.scrollTop > EDGE_PX;
    const bottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight >
      EDGE_PX;
    setEdges((current) =>
      current.top === top && current.bottom === bottom
        ? current
        : { top, bottom },
    );
  }, []);

  // Scroll only this area (never the page) so the revealed element is fully
  // visible, with a little room for the edge fade.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !revealSelector) return;
    const target = scroller.querySelector<HTMLElement>(revealSelector);
    if (!target) return;
    const box = scroller.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const margin = 32;
    if (rect.top < box.top + margin) {
      scroller.scrollTop += rect.top - box.top - margin;
    } else if (rect.bottom > box.bottom - margin) {
      scroller.scrollTop += rect.bottom - box.bottom + margin;
    }
  }, [revealSelector, revealKey]);

  // Re-check when the area resizes (window height) or its content changes
  // (items loading in, the sidebar expanding).
  useEffect(() => {
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    if (scrollerRef.current) observer.observe(scrollerRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [update]);

  return (
    <div className={cn("relative min-h-0", className)}>
      <div
        ref={scrollerRef}
        onScroll={update}
        className={cn(
          "h-full overflow-y-auto overflow-x-hidden scrollbar-none",
          scrollerClassName,
        )}
      >
        <div ref={contentRef} className={contentClassName}>
          {children}
        </div>
      </div>
      <div
        aria-hidden
        data-edge="top"
        data-visible={edges.top}
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-8 border-t bg-gradient-to-b from-background to-transparent transition-opacity duration-200",
          edges.top ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        data-edge="bottom"
        data-visible={edges.bottom}
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-8 border-b bg-gradient-to-t from-background to-transparent transition-opacity duration-200",
          edges.bottom ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
