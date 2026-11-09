"use client";

import { useId, useMemo, useState } from "react";
import { Check, Copy, Eye, Info, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RESUME_LIMITS } from "@/helpers/resume/config";
import { hasPlaceholder, placeholdersIn, type ReviewSuggestion } from "@/helpers/resume-review/suggestions";
import { cn, copyToClipboard } from "@/utils/utils";

/** `missing`: the bullet is gone. `read_only`: a sample, with nothing to apply to. */
export type SuggestionState = "ready" | "applied" | "missing" | "read_only";

const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;

const PRIORITY_CLASSES: Record<string, string> = {
  high: "text-destructive",
  medium: "text-warning",
};

/** The text with each placeholder swapped for what the user typed, where they have. */
const fillPlaceholders = (text: string, values: Record<string, string>) =>
  text.replace(/\[[^\]]+\]/g, (placeholder) => values[placeholder]?.trim() || placeholder);

/** Confirming a suggestion: its text, editable, and a field per placeholder (RE-REQ-059, RE-REQ-060). */
function ApplyEditor({
  suggested,
  isBusy,
  onApply,
  onCancel,
}: {
  suggested: string;
  isBusy: boolean;
  onApply: (text: string) => void;
  onCancel: () => void;
}) {
  const fieldId = useId();
  const [text, setText] = useState(suggested);
  const [values, setValues] = useState<Record<string, string>>({});

  const placeholders = useMemo(() => [...new Set(placeholdersIn(text))], [text]);
  const finalText = fillPlaceholders(text, values).trim();
  const isUnfilled = hasPlaceholder(finalText);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-text`}>Suggested text</Label>
        <Textarea
          id={`${fieldId}-text`}
          value={text}
          maxLength={RESUME_LIMITS.bulletChars}
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      {placeholders.map((placeholder, index) => (
        <div key={placeholder} className="space-y-1.5">
          <Label htmlFor={`${fieldId}-${index}`}>Your real value for {placeholder}</Label>
          <Input
            id={`${fieldId}-${index}`}
            value={values[placeholder] ?? ""}
            onChange={(event) => setValues((current) => ({ ...current, [placeholder]: event.target.value }))}
          />
        </div>
      ))}

      {placeholders.length > 0 && !isUnfilled && (
        <p className="text-sm">
          <span className="text-muted-foreground">Will read: </span>
          {finalText}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="brand" disabled={isBusy || isUnfilled || !finalText} onClick={() => onApply(finalText)}>
          {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirm
        </Button>
        <Button size="sm" variant="ghost" disabled={isBusy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function SuggestionCard({
  suggestion,
  state,
  isActive,
  isBusy,
  isChanged,
  checkNumbers,
  onHighlight,
  onApply,
  onUndo,
}: {
  suggestion: ReviewSuggestion;
  state: SuggestionState;
  isActive: boolean;
  isBusy: boolean;
  /** The last apply found this bullet no longer had the reviewed text. */
  isChanged: boolean;
  /** From an older review, which may state an estimate as fact (RE-REQ-059a). */
  checkNumbers: boolean;
  onHighlight: (bulletId: string | null) => void;
  onApply: (text: string) => Promise<boolean>;
  onUndo: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  const apply = async (text: string) => {
    if (await onApply(text)) setIsEditing(false);
  };

  return (
    <div
      onMouseEnter={() => canHover() && onHighlight(suggestion.bullet_id)}
      onMouseLeave={() => canHover() && onHighlight(null)}
      className={cn(
        "w-full space-y-4 rounded-xl border p-5 text-start transition-colors",
        isActive ? "border-brand/40 bg-brandSoft" : "bg-background",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{suggestion.section}</span>
        <span
          className={cn(
            "text-xs font-medium capitalize",
            PRIORITY_CLASSES[suggestion.priority] ?? "text-muted-foreground",
          )}
        >
          {suggestion.priority}
        </span>
      </div>

      <div className="space-y-2">
        <p className="text-xs line-through opacity-40">{suggestion.original}</p>
        {!isEditing && <p className="text-sm font-medium leading-relaxed">{suggestion.suggested}</p>}
      </div>

      {checkNumbers && state === "ready" && (
        <p className="text-xs text-warning">Check the numbers here. This older review may have estimated them.</p>
      )}

      {isChanged && state === "ready" && (
        <p role="alert" className="text-xs text-destructive">
          This bullet changed after the review, so the suggestion wasn&apos;t applied.
        </p>
      )}

      {state === "missing" && (
        <p className="text-xs text-muted-foreground">This bullet is no longer on the resume, so this can&apos;t be applied.</p>
      )}

      {isEditing ? (
        <ApplyEditor
          suggested={suggestion.suggested}
          isBusy={isBusy}
          onApply={apply}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {state === "applied" ? (
            <>
              <span className="flex items-center gap-1 text-xs font-medium text-success">
                <Check className="h-3.5 w-3.5" />
                Applied
              </span>
              <Button size="sm" variant="outline" disabled={isBusy} onClick={onUndo}>
                <Undo2 className="h-3.5 w-3.5" />
                Undo
              </Button>
            </>
          ) : (
            state === "ready" && (
              <Button size="sm" variant="outline" disabled={isBusy} onClick={() => setIsEditing(true)}>
                Apply
              </Button>
            )
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => copyToClipboard(suggestion.suggested, "Suggestion copied!")}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
          {/* Hovering highlights the bullet, so only touch screens need this. */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onHighlight(suggestion.bullet_id)}
            className={cn(
              "hidden [@media(hover:none)]:inline-flex",
              isActive && "border-brand/30 bg-brandSoft text-brandSoft-foreground",
            )}
          >
            <Eye className="h-3.5 w-3.5" />
            {isActive ? "Focused" : "Focus"}
          </Button>
        </div>
      )}

      <p className="flex items-center gap-2 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="h-3 w-3 shrink-0 text-muted-foreground" />
        {suggestion.reason}
      </p>
    </div>
  );
}
