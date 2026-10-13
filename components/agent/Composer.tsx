"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils/utils";

/** Elements where typing belongs to that element, not the message box. */
const TYPING_TARGETS =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
/** Open dialogs keep their keystrokes (rename, delete, memories). */
const DIALOGS = "[role='dialog'], [role='alertdialog']";

/**
 * True for a plain printable keystroke aimed at the page rather than at a
 * field or dialog: those should start a message.
 */
function shouldRedirectToComposer(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key.length !== 1) return false; // Tab, Enter, arrows, Escape…
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(TYPING_TARGETS) || target?.closest(DIALOGS)) return false;
  // Space activates the focused button or link; moving focus would cancel it.
  if (event.key === " " && target && target !== document.body) return false;
  return true;
}

/**
 * The message box. It owns the draft, so typing re-renders only this
 * component, not the conversation above it.
 */
export default function Composer({
  busy,
  onSend,
  onStop,
  initialDraft = "",
}: {
  busy: boolean;
  /** Returns false when the message wasn't sent, so the draft is kept. */
  onSend: (text: string) => boolean;
  onStop: () => void;
  /** Text the box starts with, ready to edit and send. */
  initialDraft?: string;
}) {
  const [input, setInput] = useState(initialDraft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // A prefilled draft gets focus with the caret at the end, ready to send.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!initialDraft || !textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    // Only for the draft the box started with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Typing anywhere on the page writes into the message box. Focusing during
  // keydown makes the browser insert this same keystroke into the textarea.
  useEffect(() => {
    if (busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldRedirectToComposer(event)) textareaRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy]);

  const submit = () => {
    if (onSend(input)) setInput("");
  };

  return (
    <form
      className="px-4 pb-4 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="mx-auto max-w-[46rem]">
        <div
          className={cn(
            "flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm transition-colors",
            "focus-within:border-foreground/30",
            busy && "bg-muted/40",
          )}
        >
          <Textarea
            ref={textareaRef}
            aria-label="Message"
            value={input}
            disabled={busy}
            rows={1}
            placeholder="Ask about jobs, your resume or applications…"
            className="max-h-48 min-h-10 resize-none border-0 bg-transparent px-2 py-2 text-[15px] leading-6 shadow-none [field-sizing:content] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-default disabled:bg-transparent"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          {busy ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Stop"
              className="shrink-0 rounded-xl"
              onClick={onStop}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              variant="brand"
              aria-label="Send"
              disabled={!input.trim()}
              className="shrink-0 rounded-xl"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="mt-2 hidden px-2 text-xs text-muted-foreground sm:block">
          Enter to send. Shift + Enter for a new line.
        </p>
      </div>
    </form>
  );
}
