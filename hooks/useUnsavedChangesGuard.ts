"use client";

import { useEffect, useRef, type RefObject } from "react";

export const UNSAVED_CHANGES_WARNING = "You have unsaved changes. Leave without saving?";
const SPARE_ENTRY = "__unsavedChangesGuard";

/**
 * Warns before unsaved work is lost: closing the tab or refreshing
 * (`beforeunload`), an in-app link, the browser's back button, and submitting a
 * form marked `data-leaves-page` (one that navigates in code, like AskAgentBox).
 *
 * Back inside the app is a same-document traversal, so `beforeunload` never
 * fires and it can't be cancelled. The first edit adds a spare history entry
 * for the same URL, so Back only lands on the page's real entry. From there
 * "stay" goes forward onto the spare entry, and "leave" goes back once more.
 * The spare entry stays after a save, and a clean page passes Back straight on,
 * so it never costs an extra press.
 *
 * Set `bypass.current` before a deliberate reload. `message` is what the
 * in-app prompts ask; closing or reloading shows the browser's own text.
 */
export function useUnsavedChangesGuard(
  isDirty: boolean,
  bypass: RefObject<boolean>,
  message: string = UNSAVED_CHANGES_WARNING,
) {
  const dirty = useRef(isDirty);
  const warning = useRef(message);
  // A ref, not history.state alone: Next replaces that state when the tree changes.
  const onSpareEntry = useRef(false);

  useEffect(() => {
    dirty.current = isDirty;
    warning.current = message;
  }, [isDirty, message]);

  useEffect(() => {
    onSpareEntry.current = window.history.state?.[SPARE_ENTRY] === true;
    const guardedUrl = window.location.href;
    let returning = false;

    const onPopState = (event: PopStateEvent) => {
      if (returning) {
        returning = false;
        event.stopImmediatePropagation();
        return;
      }
      if (!onSpareEntry.current || window.location.href !== guardedUrl) return;

      // Same page, so Next has nothing to do here.
      event.stopImmediatePropagation();
      if (dirty.current && !window.confirm(warning.current)) {
        returning = true;
        window.history.forward();
        return;
      }
      onSpareEntry.current = false;
      bypass.current = true;
      window.history.back();
    };

    // Capture runs before the listener Next adds to window.
    window.addEventListener("popstate", onPopState, true);
    return () => window.removeEventListener("popstate", onPopState, true);
  }, [bypass]);

  useEffect(() => {
    if (!isDirty) return;

    if (!onSpareEntry.current) {
      // Copying the state keeps __NA, so Next leaves this push alone.
      window.history.pushState({ ...window.history.state, [SPARE_ENTRY]: true }, "");
      onSpareEntry.current = true;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypass.current) return;
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      if (!window.confirm(warning.current)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const onSubmit = (event: SubmitEvent) => {
      if (!(event.target as Element | null)?.closest?.("[data-leaves-page]")) return;
      if (!window.confirm(warning.current)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [isDirty, bypass]);
}
