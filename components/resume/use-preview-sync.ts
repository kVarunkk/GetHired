"use client";

import { useEffect, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { STICKY_BAR_HEIGHT_VAR } from "@/components/StickyActionBar";

const TARGET_ATTRIBUTE = "data-resume-target";
const TARGET = `[${TARGET_ATTRIBUTE}]`;

/** Long enough that moving across the preview doesn't drag the form along. */
const HOVER_DELAY_MS = 200;
const PREVIEW_MARGIN_PX = 16;
const HOVER_SCROLL_KEY = "resume-editor-hover-scroll";

const findTarget = (root: Element | null, id: string) =>
  Array.from(root?.querySelectorAll(TARGET) ?? []).find((element) => element.getAttribute(TARGET_ATTRIBUTE) === id);

/** Scrolls only the preview: scrollIntoView would move the page, and the focused field with it. */
function revealInPreview(preview: HTMLElement, target: Element) {
  const box = preview.getBoundingClientRect();
  const { top, bottom } = target.getBoundingClientRect();
  if (top >= box.top && bottom <= box.bottom) return;
  preview.scrollTo({ top: preview.scrollTop + top - box.top - PREVIEW_MARGIN_PX, behavior: "smooth" });
}

function revealInForm(field: Element) {
  const barHeight = parseFloat(document.documentElement.style.getPropertyValue(STICKY_BAR_HEIGHT_VAR)) || 0;
  const { top, bottom } = field.getBoundingClientRect();
  if (top >= 0 && bottom <= window.innerHeight - barHeight) return;
  field.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Keeps the form and the preview on the same part of the resume: focusing a
 * field reveals it in the preview, and resting the mouse on the preview reveals
 * that part in the form. Both sides mark their parts with `data-resume-target`,
 * and the smallest match wins. A part that's empty isn't in the preview, so
 * focus falls back to the entry or section around it. The hover half can be
 * switched off, and that's remembered on this device. Focus always follows.
 */
export function usePreviewSync() {
  const formRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const hovered = useRef<string | null>(null);
  const mouse = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hoverScroll, setHoverScrollState] = useState(true);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(HOVER_SCROLL_KEY) === "off") setHoverScrollState(false);
    } catch {
      // Blocked storage only costs the remembered choice.
    }
  }, []);

  const setHoverScroll = (enabled: boolean) => {
    setHoverScrollState(enabled);
    try {
      window.localStorage.setItem(HOVER_SCROLL_KEY, enabled ? "on" : "off");
    } catch {
      // As above.
    }
  };

  const onFormFocus = (event: FocusEvent<HTMLElement>) => {
    const preview = previewRef.current;
    if (!preview) return;

    let field = (event.target as Element).closest(TARGET);
    while (field) {
      const target = findTarget(preview, field.getAttribute(TARGET_ATTRIBUTE) ?? "");
      if (target) {
        revealInPreview(preview, target);
        return;
      }
      field = field.parentElement?.closest(TARGET) ?? null;
    }
  };

  const onPreviewMouseMove = (event: MouseEvent<HTMLElement>) => {
    if (!hoverScroll) return;

    // Browsers send a move when content scrolls under a still mouse. Following
    // that would pull the form away from the field that just scrolled the preview.
    const { clientX: x, clientY: y } = event;
    if (mouse.current?.x === x && mouse.current?.y === y) return;
    mouse.current = { x, y };

    const id = (event.target as Element).closest(TARGET)?.getAttribute(TARGET_ATTRIBUTE) ?? null;
    if (id === hovered.current) return;
    hovered.current = id;
    clearTimeout(timer.current);
    if (!id) return;

    timer.current = setTimeout(() => {
      const field = findTarget(formRef.current, id);
      if (field) revealInForm(field);
    }, HOVER_DELAY_MS);
  };

  const onPreviewMouseLeave = () => {
    clearTimeout(timer.current);
    hovered.current = null;
    mouse.current = null;
  };

  return { formRef, previewRef, onFormFocus, onPreviewMouseMove, onPreviewMouseLeave, hoverScroll, setHoverScroll };
}
