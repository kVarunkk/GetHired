"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarCheck, CalendarX, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { disconnectCalendarAction } from "@/app/actions/calendar/disconnect";
import { saveMyAvailabilityAction } from "@/app/actions/calendar/save-availability";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { availabilityDefaults, availabilitySchema } from "@/helpers/calendar/availability-schema";
import {
  connectCalendarHref,
  MY_CALENDAR_PATH,
  WEEKDAYS,
  type Weekday,
  type WorkingHours,
} from "@/helpers/calendar/config";
import { connectErrorMessage } from "@/helpers/calendar/copy";
import { browserTimeZone, timeZoneOptions } from "@/helpers/companies/time-zone";
import { formatDate } from "@/utils/date";

const DAY_NAMES: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export type CalendarConnectionView = {
  accountEmail: string;
  status: "active" | "error";
  connectedAt: string;
};

type Props = {
  connection: CalendarConnectionView | null;
  availability: { time_zone: string; working_hours: unknown } | null;
  companyZone: string | null;
  /** From the OAuth callback's redirect. */
  notice?: { connected?: boolean; error?: string | null };
};

function ConnectionCard({ connection }: { connection: CalendarConnectionView | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const href = connectCalendarHref(MY_CALENDAR_PATH);

  const disconnect = async () => {
    setBusy(true);
    try {
      const result = await disconnectCalendarAction();
      if (result.ok) {
        toast.success("Google Calendar disconnected.");
        router.refresh();
      } else toast.error(result.error);
    } catch {
      toast.error("Couldn't disconnect your calendar. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!connection) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Your Google Calendar isn&apos;t connected. Connect it so teammates can book interviews when you&apos;re free.
          GetHired sees only when you&apos;re busy, never what your other events are.
        </p>
        <Button asChild variant="brand">
          <a href={href}>Connect Google Calendar</a>
        </Button>
      </div>
    );
  }

  const broken = connection.status === "error";
  return (
    <div className="flex flex-col gap-3">
      {broken && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          GetHired can no longer reach your Google Calendar. Reconnect it to keep booking and moving interviews.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          {broken ? (
            <CalendarX className="h-4 w-4 shrink-0 text-destructive" />
          ) : (
            <CalendarCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium">{connection.accountEmail}</span>
          <span className="text-muted-foreground">
            {broken ? "· needs reconnecting" : `· connected ${formatDate(connection.connectedAt)}`}
          </span>
        </div>
        <div className="flex gap-2">
          {broken && (
            <Button asChild variant="brand">
              <a href={href}>Reconnect</a>
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Disconnect
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Google Calendar?</AlertDialogTitle>
                <AlertDialogDescription>
                  GetHired&apos;s access is removed at Google. Interviews you organized stay on calendars, but they
                  can&apos;t be moved or cancelled from GetHired until someone reschedules them.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void disconnect()}>Disconnect</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

function WorkingHoursForm({ initial }: { initial: { timeZone: string; workingHours: WorkingHours } }) {
  const [zone, setZone] = useState(initial.timeZone);
  const [hours, setHours] = useState<WorkingHours>(initial.workingHours);
  const [saving, setSaving] = useState(false);
  const zones = useMemo(() => timeZoneOptions(zone), [zone]);

  const parsed = availabilitySchema.safeParse({ timeZone: zone, workingHours: hours });
  const issues = parsed.success ? [] : parsed.error.issues;
  const dayError = (day: Weekday) => issues.find((i) => i.path[1] === day)?.message;
  const formError = issues.find((i) => i.path.length < 2)?.message;

  const setDay = (day: Weekday, value: WorkingHours[Weekday]) =>
    setHours((h) => {
      const next = { ...h };
      if (value) next[day] = value;
      else delete next[day];
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const result = await saveMyAvailabilityAction({ timeZone: zone, workingHours: hours });
      if (result.ok) toast.success("Working hours saved.");
      else toast.error(result.error);
    } catch {
      toast.error("Couldn't save your working hours. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="availability-zone">Time zone</Label>
        <Select value={zone} onValueChange={setZone}>
          <SelectTrigger id="availability-zone" aria-label="Time zone" className="w-full max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {zones.map((z) => (
              <SelectItem key={z} value={z}>
                {z.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ul className="flex flex-col divide-y rounded-md border">
        {WEEKDAYS.map((day) => {
          const value = hours[day];
          const error = dayError(day);
          return (
            <li key={day} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="flex w-36 items-center gap-2">
                <Switch
                  id={`day-${day}`}
                  aria-label={DAY_NAMES[day]}
                  checked={Boolean(value)}
                  onCheckedChange={(on) => setDay(day, on ? { start: "10:00", end: "18:00" } : undefined)}
                />
                <Label htmlFor={`day-${day}`} className="text-sm">
                  {DAY_NAMES[day]}
                </Label>
              </div>
              {value ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="time"
                    aria-label={`${DAY_NAMES[day]} start`}
                    value={value.start}
                    onChange={(e) => setDay(day, { ...value, start: e.target.value })}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input
                    type="time"
                    aria-label={`${DAY_NAMES[day]} end`}
                    value={value.end}
                    onChange={(e) => setDay(day, { ...value, end: e.target.value })}
                    className="w-32"
                  />
                  {error && <span className="text-sm text-destructive">{error}</span>}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Not working</span>
              )}
            </li>
          );
        })}
      </ul>
      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div>
        <Button disabled={saving || !parsed.success} onClick={() => void save()}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save working hours
        </Button>
      </div>
    </div>
  );
}

/**
 * Settings → My calendar (IVT-037, IV-REQ-010/011): the member's own Google
 * Calendar connection and working hours. Self-scheduling offers only slots
 * inside every panel member's hours.
 */
export default function MyCalendarSettings({ connection, availability, companyZone, notice }: Props) {
  const initial = useMemo(
    () => availabilityDefaults(availability, { browserZone: browserTimeZone(), companyZone }),
    [availability, companyZone],
  );
  const noticeError = connectErrorMessage(notice?.error);

  return (
    <div className="flex flex-col gap-6">
      {notice?.connected && !noticeError && (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">Google Calendar connected.</p>
      )}
      {noticeError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{noticeError}</p>
      )}
      <section className="flex min-w-0 flex-col gap-4 rounded-lg border p-5">
        <h3 className="text-sm font-semibold">Google Calendar</h3>
        <ConnectionCard connection={connection} />
      </section>
      <section className="flex min-w-0 flex-col gap-4 rounded-lg border p-5">
        <div>
          <h3 className="text-sm font-semibold">Working hours</h3>
          <p className="text-sm text-muted-foreground">
            Candidates picking their own time only see slots inside every interviewer&apos;s hours.
          </p>
        </div>
        <WorkingHoursForm key={`${initial.timeZone}`} initial={initial} />
      </section>
    </div>
  );
}
