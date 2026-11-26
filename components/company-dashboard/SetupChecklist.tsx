"use client";

import { useEffect, useState } from "react";
import { Circle, CircleCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { SetupProgress } from "@/helpers/company-dashboard/summary";
import TrackedLink from "./TrackedLink";

export const setupDismissedKey = (companyId: string) => `gethired:company-setup-dismissed:${companyId}`;

/**
 * CD-REQ-029/030: what a new company has left to set up. Gone once every step
 * the member can take is done, or once they dismiss it (kept in this browser).
 */
export default function SetupChecklist({ companyId, progress }: { companyId: string; progress: SetupProgress }) {
  // Null until the browser's choice is read, so a dismissed card never flashes.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(setupDismissedKey(companyId)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [companyId]);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(setupDismissedKey(companyId), "1");
    } catch {
      // Storage blocked: dismissed for this visit only.
    }
  };

  if (dismissed !== false || progress.done >= progress.total) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Finish setting up</h2>
            <p className="text-sm text-muted-foreground">
              {progress.done} of {progress.total} done
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
            aria-label="Dismiss the setup checklist"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Progress value={(progress.done / progress.total) * 100} aria-label="Setup progress" className="h-2" />
        <ul className="flex flex-col gap-2 text-sm">
          {progress.items.map((item) => (
            <li key={item.key} className="flex items-center gap-2">
              {item.done ? (
                <>
                  <CircleCheck className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span className="text-muted-foreground line-through">{item.label}</span>
                  <span className="sr-only">(done)</span>
                </>
              ) : (
                <>
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <TrackedLink
                    href={item.href}
                    track={{ section: "setup", kind: item.key, action: "open" }}
                    className="font-medium underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground"
                  >
                    {item.label}
                  </TrackedLink>
                </>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
