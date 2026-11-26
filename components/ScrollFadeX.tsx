"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/utils";

/** Distance from an edge, in px, that still counts as being at it. */
const EDGE_PX = 1;
const FADE = "2rem";

/**
 * A horizontally scrolling area that fades its content out at each side that
 * has more beyond it. It's a mask, not an overlay, so it works over any
 * background and never blocks clicks. ScrollFade is the vertical one.
 */
export default function ScrollFadeX({
  children,
  className,
  fadeStart = true,
}: {
  children: React.ReactNode;
  /** Classes for the scrolling box. */
  className?: string;
  /** False when a sticky first column covers the left edge. */
  fadeStart?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const scroller = ref.current;
    if (!scroller) return;
    const start = scroller.scrollLeft > EDGE_PX;
    const end = scroller.scrollWidth - scroller.scrollLeft - scroller.clientWidth > EDGE_PX;
    setEdges((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, []);

  // Re-check when the area or its content resizes (rows loading in, filtering).
  useEffect(() => {
    update();
    const scroller = ref.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    for (const child of scroller.children) observer.observe(child);
    return () => observer.disconnect();
  }, [update]);

  const left = fadeStart && edges.start;
  const mask =
    left || edges.end
      ? `linear-gradient(to right, ${left ? "transparent" : "black"}, black ${FADE}, black calc(100% - ${FADE}), ${edges.end ? "transparent" : "black"})`
      : undefined;

  return (
    <div
      ref={ref}
      onScroll={update}
      data-fade-start={left}
      data-fade-end={edges.end}
      className={cn("overflow-x-auto", className)}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {children}
    </div>
  );
}
