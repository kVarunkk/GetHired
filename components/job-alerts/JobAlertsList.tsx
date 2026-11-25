"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { deleteJobAlertAction } from "@/app/actions/job-alerts/delete-job-alert";
import { updateJobAlertAction } from "@/app/actions/job-alerts/update-job-alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { JobAlert } from "@/helpers/job-alerts/alerts";
import { alertNameParts, ALERT_NAME_MAX } from "@/helpers/job-alerts/name";

/** JA-REQ-040: the viewer's alerts, one row each, with every control inline. */
export default function JobAlertsList({ initialAlerts }: { initialAlerts: JobAlert[] }) {
  const [alerts, setAlerts] = useState(initialAlerts);

  if (alerts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        You have no job alerts.{" "}
        <Link href="/jobs" className="underline">
          Search jobs
        </Link>{" "}
        and choose Alert to get new matches by email.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {alerts.map((alert) => (
        <AlertRow
          key={alert.id}
          alert={alert}
          onChange={(next) => setAlerts((list) => list.map((a) => (a.id === next.id ? next : a)))}
          onDeleted={() => setAlerts((list) => list.filter((a) => a.id !== alert.id))}
        />
      ))}
    </ul>
  );
}

function AlertRow({
  alert,
  onChange,
  onDeleted,
}: {
  alert: JobAlert;
  onChange: (alert: JobAlert) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(alert.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { details } = alertNameParts(alert.filters);

  const update = (patch: { on?: boolean; frequency?: "daily" | "weekly"; name?: string }, revert?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await updateJobAlertAction({ id: alert.id, ...patch });
      if (!result.ok) {
        revert?.();
        setError(result.error);
        return;
      }
      onChange(result.alert);
      setName(result.alert.name);
    });

  const rename = () => {
    const next = name.trim();
    if (next === alert.name) return;
    update({ name: next }, () => setName(alert.name));
  };

  const remove = () =>
    startTransition(async () => {
      setError(null);
      const result = await deleteJobAlertAction({ id: alert.id });
      if (!result.ok) return setError(result.error);
      onDeleted();
    });

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <Input
          aria-label="Alert name"
          value={name}
          maxLength={ALERT_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="h-9 font-semibold"
        />
        <Switch
          aria-label={alert.on ? "Pause alert" : "Turn alert on"}
          checked={alert.on}
          disabled={pending}
          onCheckedChange={(on) => update({ on })}
        />
      </div>
      {details.length > 0 && <p className="text-sm text-muted-foreground">{details.join(" · ")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={alert.frequency}
          disabled={pending}
          onValueChange={(frequency) => update({ frequency: frequency as "daily" | "weekly" })}
        >
          <SelectTrigger className="h-8 w-[110px]" aria-label="Frequency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="daily">Daily</SelectItem>
          </SelectContent>
        </Select>
        <Button asChild variant="outline" size="sm">
          <Link href={alert.url}>View jobs</Link>
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="ml-auto" aria-label={`Delete ${alert.name}`}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this alert?</AlertDialogTitle>
              <AlertDialogDescription>
                You&apos;ll stop getting emails for {alert.name}. You can create it again from the jobs page.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={remove}>Delete alert</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
