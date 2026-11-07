"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RESUME_MONTHS, isResumeDateBefore, readResumeDate } from "@/helpers/resume/resume-dates";
import { cn } from "@/utils/utils";

const FIRST_YEAR = 1950;
const YEARS_AHEAD = 10;
const PRESENT = "Present";

/** Picks a month and year. The value stays a string, so a date as written shows until it's replaced. */
export default function ResumeDatePicker({
  id,
  value,
  onChange,
  allowPresent = false,
  notBefore,
  notAfter,
  invalid = false,
}: {
  id: string;
  value: string | undefined;
  onChange: (value: string) => void;
  /** For an end date: the entry is still going on. */
  allowPresent?: boolean;
  /** The entry's start date, for an end date. */
  notBefore?: string;
  /** The entry's end date, for a start date. */
  notAfter?: string;
  invalid?: boolean;
}) {
  const thisYear = new Date().getFullYear();
  const selected = readResumeDate(value);

  const firstYear = readResumeDate(notBefore).year ?? FIRST_YEAR;
  const lastYear = readResumeDate(notAfter).year ?? thisYear + YEARS_AHEAD;
  const years = Array.from({ length: Math.max(lastYear - firstYear + 1, 0) }, (_, i) => lastYear - i);

  const openingYear = () => Math.min(Math.max(selected.year ?? thisYear, firstYear), lastYear);
  const isOutOfRange = (date: string) => isResumeDateBefore(date, notBefore) || isResumeDateBefore(notAfter, date);

  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(openingYear);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setYear(openingYear());
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-invalid={invalid || undefined}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}
        >
          <span className="truncate">{value || "Select date"}</span>
          <CalendarDays className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3">
        <Select value={String(year)} onValueChange={(next) => setYear(Number(next))}>
          <SelectTrigger aria-label="Year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="grid grid-cols-3 gap-1">
          {RESUME_MONTHS.map((month, index) => {
            const isSelected = selected.year === year && selected.month === index;
            return (
              <Button
                key={month}
                type="button"
                size="sm"
                variant={isSelected ? "brand" : "ghost"}
                aria-pressed={isSelected}
                disabled={isOutOfRange(`${month} ${year}`)}
                onClick={() => pick(`${month} ${year}`)}
              >
                {month}
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1 border-t pt-2">
          {allowPresent && (
            <Button type="button" size="sm" variant="ghost" onClick={() => pick(PRESENT)}>
              {PRESENT}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isOutOfRange(String(year))}
            onClick={() => pick(String(year))}
          >
            Year only
          </Button>
          {value && (
            <Button type="button" size="sm" variant="ghost" onClick={() => pick("")}>
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
