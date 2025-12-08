"use client";

import { useEffect, useState } from "react";
import { Input } from "./ui/input";
import { v4 as uuidv4 } from "uuid";
import { Check, X } from "lucide-react";
import { IFormData } from "@/lib/types";
import { FiltersState } from "./FilterComponent";

interface MultiKeywordInputProps {
  updateFormValues: (
    type: keyof IFormData | keyof FiltersState,
    keywords: {
      id: string;
      content: string;
    }[]
  ) => void;
  type: keyof IFormData | keyof FiltersState;
  placeholder?: string;
  initialKeywords?: {
    id: string;
    content: string;
  }[];
  className?: string;
}

export default function MultiKeywordInput({
  type,
  updateFormValues,
  placeholder,
  initialKeywords,
  className = "",
}: MultiKeywordInputProps) {
  const [input, setInput] = useState("");
  const [keywords, setKeywords] = useState<
    {
      id: string;
      content: string;
    }[]
  >(initialKeywords ?? []);

  useEffect(() => {
    if (
      initialKeywords &&
      initialKeywords.length > 0 &&
      keywords.length === 0
    ) {
      setKeywords(initialKeywords);
    }
  }, [initialKeywords, keywords.length]);

  useEffect(() => {
    updateFormValues(type, keywords);
  }, [keywords, type, updateFormValues]);

  const addKeyword = () => {
    const trimmed = input.trim();
    if (
      !trimmed ||
      keywords.some((k) => k.content.toLowerCase() === trimmed.toLowerCase())
    ) {
      setInput("");
      return;
    }
    setKeywords((prev) => [
      ...prev,
      {
        id: uuidv4(),
        content: trimmed,
      },
    ]);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      const trimmed = input.trim();
      if (
        keywords.some((k) => k.content.toLowerCase() === trimmed.toLowerCase())
      ) {
        {
          setInput("");
          return;
        }
      }
      setKeywords((prev) => [
        ...prev,
        {
          id: uuidv4(),
          content: trimmed,
        },
      ]);
      setInput("");
    }
  };

  const removeKeyword = (id: string) => {
    setKeywords((prev) => prev.filter((_) => _.id !== id));
  };

  return (
    <div className="flex flex-col gap-2 relative">
      <div className="flex items-center gap-2">
        <Input
          id={type}
          name={type}
          placeholder={placeholder ?? ""}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className={`${className}`}
        />
        {input.trim() && (
          <div className="flex items-center text-muted-foreground">
            <button
              onClick={() => setInput("")}
              className="p-1 hover:text-primary"
            >
              <X className="h-4 w-4" />
            </button>
            <button onClick={addKeyword} className="p-1 hover:text-primary">
              <Check className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {keywords.map(({ content, id }) => (
            <span
              key={id}
              className="flex items-center border border-border  px-2 py-1 rounded text-sm"
            >
              {content}
              <button onClick={() => removeKeyword(id)} className="p-1">
                <X className="h-4 w-4" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
