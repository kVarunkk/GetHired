import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

const setup = (isDirty: boolean) => {
  const bypass = { current: false };
  const hook = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty, bypass), { initialProps: { dirty: isDirty } });
  return { ...hook, bypass };
};

/** What the browser does on Back. Returns whether Next's listener would have seen it. */
const popState = () => {
  const nextListener = vi.fn();
  window.addEventListener("popstate", nextListener);
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  window.removeEventListener("popstate", nextListener);
  return nextListener.mock.calls.length > 0;
};

describe("useUnsavedChangesGuard and forms that leave the page", () => {
  const submit = (marked: boolean) => {
    const form = document.createElement("form");
    if (marked) form.setAttribute("data-leaves-page", "");
    document.body.appendChild(form);
    const event = new Event("submit", { bubbles: true, cancelable: true });
    const stop = vi.spyOn(event, "stopPropagation");
    form.dispatchEvent(event);
    form.remove();
    return { prevented: event.defaultPrevented, stopped: stop.mock.calls.length > 0 };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the page if told to stay", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    setup(true);

    expect(submit(true)).toEqual({ prevented: true, stopped: true });
  });

  it("lets the form through if told to leave", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    setup(true);

    expect(submit(true)).toEqual({ prevented: false, stopped: false });
  });

  it("doesn't ask with nothing to lose", () => {
    const confirm = vi.spyOn(window, "confirm");
    setup(false);

    submit(true);

    expect(confirm).not.toHaveBeenCalled();
  });

  it("leaves other forms alone", () => {
    const confirm = vi.spyOn(window, "confirm");
    setup(true);

    submit(false);

    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("useUnsavedChangesGuard and the browser's back button", () => {
  let back: ReturnType<typeof vi.spyOn>;
  let forward: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.history.replaceState({ __NA: true }, "");
    back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds no history entry until there's something to lose", () => {
    const push = vi.spyOn(window.history, "pushState");
    setup(false);

    expect(push).not.toHaveBeenCalled();
  });

  it("adds one spare entry on the first edit, keeping Next's state", () => {
    const push = vi.spyOn(window.history, "pushState");
    const { rerender } = setup(false);

    rerender({ dirty: true });
    rerender({ dirty: false });
    rerender({ dirty: true });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toMatchObject({ __NA: true });
  });

  it("asks, and stays on the page if told to", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { bypass } = setup(true);

    expect(popState()).toBe(false);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(bypass.current).toBe(false);
  });

  it("doesn't ask again for its own step forward", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    setup(true);

    popState();
    expect(popState()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);

    popState();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("goes back for real when told to, with no second warning", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { bypass } = setup(true);

    popState();

    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).not.toHaveBeenCalled();
    expect(bypass.current).toBe(true);
  });

  it("hands the next traversal to Next after leaving", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    setup(true);

    popState();

    expect(popState()).toBe(true);
  });

  it("passes Back straight on after a save, without asking", () => {
    const confirm = vi.spyOn(window, "confirm");
    const { rerender } = setup(true);

    rerender({ dirty: false });
    popState();

    expect(confirm).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("leaves a page with no spare entry to Next", () => {
    const confirm = vi.spyOn(window, "confirm");
    setup(false);

    expect(popState()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it("picks up a spare entry left from an earlier visit", () => {
    window.history.replaceState({ __NA: true, __unsavedChangesGuard: true }, "");
    const push = vi.spyOn(window.history, "pushState");
    const { rerender } = setup(false);

    rerender({ dirty: true });

    expect(push).not.toHaveBeenCalled();
  });

  it("stops listening when the page goes", () => {
    const confirm = vi.spyOn(window, "confirm");
    const { unmount } = setup(true);

    unmount();

    expect(popState()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
