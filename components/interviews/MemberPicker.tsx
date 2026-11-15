"use client";

import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PANEL_MAX } from "@/helpers/interviews/config";

export type MemberOption = { userId: string; name: string };

/**
 * Picks up to `max` company members (a plan's default interviewers, an
 * interview's panel). Members no longer on the team still show by id until
 * they're unticked, so a saved choice never vanishes silently.
 */
export default function MemberPicker({
  id,
  members,
  value,
  onChange,
  max = PANEL_MAX,
  disabled,
  placeholder = "Pick interviewers",
  badges,
}: {
  id?: string;
  members: MemberOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  /** Something to show beside a member's name (a calendar status, later). */
  badges?: Record<string, React.ReactNode>;
}) {
  const [open, setOpen] = useState(false);
  const known = new Map(members.map((m) => [m.userId, m.name]));
  const nameOf = (userId: string) => known.get(userId) ?? "Former member";
  const options = [...members, ...value.filter((v) => !known.has(v)).map((userId) => ({ userId, name: nameOf(userId) }))];
  const full = value.length >= max;

  const toggle = (userId: string, on: boolean) => {
    if (on) {
      if (!value.includes(userId) && !full) onChange([...value, userId]);
    } else {
      onChange(value.filter((v) => v !== userId));
    }
  };

  const summary = value.length === 0 ? placeholder : value.map(nameOf).join(", ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={value.length === 0 ? "truncate text-muted-foreground" : "truncate"}>{summary}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="max-h-72 overflow-y-auto py-1" role="group" aria-label="Team members">
          {options.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No team members.</p>}
          {options.map((m) => {
            const checked = value.includes(m.userId);
            const inputId = `${id ?? "member"}-${m.userId}`;
            return (
              <label
                key={m.userId}
                htmlFor={inputId}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60"
              >
                <Checkbox
                  id={inputId}
                  checked={checked}
                  disabled={!checked && full}
                  onCheckedChange={(on) => toggle(m.userId, on === true)}
                />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                {badges?.[m.userId]}
              </label>
            );
          })}
        </div>
        {full && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">At most {max} people.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
