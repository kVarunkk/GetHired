"use client";

import { useState, useCallback, useMemo, memo } from "react";
import { Input } from "./ui/input";
import { v4 as uuidv4 } from "uuid";
import { Check, X } from "lucide-react";
import { cn } from "@/utils/utils";
import MultiKeywordSelect from "./MultiKeywordSelect";

interface GenericFormData {
  [key: string]: string | number | string[];
}

interface MultiKeywordSelectInputProps {
  name: keyof GenericFormData;
  onChange: (name: keyof GenericFormData, keywords: string[]) => void;
  placeholder?: string;
  initialKeywords?: string[];
  className?: string;
  label?: string;
  availableItems?: string[];
}

export default memo(function MultiKeywordSelectInput({
  name,
  onChange,
  placeholder,
  initialKeywords = [],
  className = "",
  availableItems = [],
}: MultiKeywordSelectInputProps) {
  const [input, setInput] = useState("");

  const displayedKeywords = useMemo(() => {
    return initialKeywords.map((content) => ({ id: uuidv4(), content }));
  }, [initialKeywords]);

  const addKeyword = useCallback(
    (contentToAdd: string) => {
      const trimmed = contentToAdd.trim();
      if (
        !trimmed ||
        initialKeywords.some((k) => k.toLowerCase() === trimmed.toLowerCase())
      ) {
        return;
      }
      onChange(name, [...initialKeywords, trimmed]);
    },
    [name, onChange, initialKeywords],
  );

  const handleInputAdd = useCallback(() => {
    addKeyword(input);
    setInput("");
  }, [addKeyword, input]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && input.trim()) {
        e.preventDefault();
        handleInputAdd();
      }
    },
    [input, handleInputAdd],
  );

  const removeKeyword = useCallback(
    (contentToRemove: string) => {
      onChange(
        name,
        initialKeywords.filter((content) => content !== contentToRemove),
      );
    },
    [name, onChange, initialKeywords],
  );

  const filteredAvailableItems = useMemo(() => {
    return availableItems.filter((item) =>
      item.toLowerCase().includes(input.toLowerCase()),
    );
  }, [availableItems, input]);

  return (
    <div className={cn("flex flex-col gap-2 relative", className)}>
      <div className="flex gap-2">
        <div
          id={`${name}-container`}
          // The wrapper is the field: one border around the input and the picker, with the Input primitive's focus style.
          className="flex items-center w-full rounded-lg border border-input bg-background transition-colors hover:border-foreground/20 focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-foreground/5"
        >
          <Input
            name={String(name)}
            placeholder={placeholder ?? "Type to add or select from dropdown"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="!rounded-r-none !border-0 bg-transparent !ring-0 text-sm"
          />
          {filteredAvailableItems.length > 0 && (
            <MultiKeywordSelect
              name={name}
              placeholder={""}
              initialKeywords={displayedKeywords.map((each) => each.content)}
              onChange={onChange}
              className=" w-fit"
              availableItems={filteredAvailableItems}
              isVirtualized={true}
              showKeywords={false}
            />
          )}
        </div>
        {input.trim() && (
          <div className="flex items-center text-muted-foreground">
            <button
              type="button"
              onClick={() => setInput("")}
              className="p-1 hover:text-primary"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleInputAdd}
              className="p-1 hover:text-primary"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {displayedKeywords.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {displayedKeywords.map(({ content, id }) => (
            <span
              key={id}
              className="flex items-center gap-0.5 rounded-full border py-0.5 pl-2.5 pr-1 text-sm"
            >
              {content}
              <button
                type="button"
                onClick={() => removeKeyword(content)}
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
