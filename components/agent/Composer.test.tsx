import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Composer from "./Composer";

const renderComposer = (busy = false, extra?: React.ReactNode) =>
  render(
    <>
      {extra}
      <Composer busy={busy} onSend={vi.fn(() => true)} onStop={vi.fn()} placeholder="Ask anything" />
    </>,
  );

const message = () => screen.getByLabelText("Message");

/** A key pressed while focus is on `target` (the page itself by default). */
const press = (key: string, init: KeyboardEventInit = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, bubbles: true, ...init });

describe("Composer: type anywhere to write a message", () => {
  it("moves focus to the message box when a character is typed on the page", () => {
    renderComposer();
    expect(message()).not.toHaveFocus();

    press("a");

    expect(message()).toHaveFocus();
  });

  it("leaves other text fields alone", () => {
    renderComposer(false, <input aria-label="Session title" />);
    const title = screen.getByLabelText("Session title");
    title.focus();

    press("a", {}, title);

    expect(title).toHaveFocus();
  });

  it.each([
    ["Ctrl shortcuts", "k", { ctrlKey: true }],
    ["Cmd shortcuts", "k", { metaKey: true }],
    ["Alt shortcuts", "k", { altKey: true }],
    ["Tab", "Tab", {}],
    ["arrow keys", "ArrowDown", {}],
    ["Escape", "Escape", {}],
  ])("ignores %s", (_label, key, init) => {
    renderComposer();

    press(key, init);

    expect(message()).not.toHaveFocus();
  });

  it("lets Space activate a focused button instead of moving focus", () => {
    renderComposer(false, <button>Approve</button>);
    const approve = screen.getByRole("button", { name: "Approve" });
    approve.focus();

    press(" ", {}, approve);

    expect(approve).toHaveFocus();
  });

  it("still redirects other characters typed while a button has focus", () => {
    renderComposer(false, <button>Regenerate</button>);
    const regenerate = screen.getByRole("button", { name: "Regenerate" });
    regenerate.focus();

    press("h", {}, regenerate);

    expect(message()).toHaveFocus();
  });

  it("does not steal focus from an open dialog", () => {
    renderComposer(
      false,
      <div role="dialog">
        <button>Delete</button>
      </div>,
    );
    const button = screen.getByRole("button", { name: "Delete" });
    button.focus();

    press("a", {}, button);

    expect(button).toHaveFocus();
  });

  it("does nothing while a reply is in progress", () => {
    renderComposer(true);

    press("a");

    expect(message()).not.toHaveFocus();
  });
});

describe("Composer: starting with a draft", () => {
  it("prefills the box, focused with the caret at the end, without sending", () => {
    const onSend = vi.fn(() => true);
    render(
      <Composer busy={false} onSend={onSend} onStop={vi.fn()} initialDraft="remote Go jobs" placeholder="Ask anything" />,
    );

    const box = message() as HTMLTextAreaElement;
    expect(box).toHaveValue("remote Go jobs");
    expect(box).toHaveFocus();
    expect(box.selectionStart).toBe("remote Go jobs".length);
    expect(onSend).not.toHaveBeenCalled();
  });
});
