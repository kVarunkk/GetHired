"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StageChoices } from "@/helpers/candidates/stage-map";

/** Radix SelectItem can't have an empty value. */
const DESTINATION = "destination";

/**
 * BI-REQ-015a: each distinct value of the Stage column, with the pipeline
 * stage it goes to. Values matching a stage's name come preselected; the rest
 * go to the destination stage unless picked.
 */
export default function StageMapper({
  values,
  stages,
  choices,
  destinationName,
  onChange,
  disabled = false,
}: {
  values: string[];
  stages: { id: string; name: string }[];
  choices: StageChoices;
  /** The import's stage, where unmatched values go. */
  destinationName: string;
  onChange: (choices: StageChoices) => void;
  disabled?: boolean;
}) {
  if (values.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">Stages from your file</legend>
      <p className="text-sm text-muted-foreground">
        Each person starts at the stage their row names. Pick where each value goes.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {values.map((value, i) => (
          <div key={value} className="flex flex-col gap-1.5">
            <Label htmlFor={`stage-map-${i}`} className="truncate font-normal">
              {value}
            </Label>
            <Select
              value={choices[value] ?? DESTINATION}
              onValueChange={(next) => onChange({ ...choices, [value]: next === DESTINATION ? null : next })}
              disabled={disabled}
            >
              <SelectTrigger id={`stage-map-${i}`} aria-label={`Stage for “${value}”`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DESTINATION}>The import&apos;s stage ({destinationName})</SelectItem>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
