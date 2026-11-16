"use client";

import { useEffect, useMemo, useReducer } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Clock, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { browserTimeZone, timeZoneOptions } from "@/helpers/companies/time-zone";
import { selfSchedulingMessage } from "@/helpers/interviews/self-scheduling-copy";
import type { PublicLink } from "@/helpers/interviews/self-scheduling";
import {
  initialSelfSchedule,
  pendingAction,
  selfScheduleReducer,
  type Done,
  type Slot,
} from "./self-schedule-machine";

const dayKey = (iso: string, zone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const dayLabel = (iso: string, zone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
const timeLabel = (iso: string, zone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const fullLabel = (iso: string, zone: string) => `${dayLabel(iso, zone)}, ${timeLabel(iso, zone)}`;

function byDay(slots: Slot[], zone: string) {
  const days: { key: string; slots: Slot[] }[] = [];
  for (const slot of [...slots].sort((a, b) => a.start.localeCompare(b.start))) {
    const key = dayKey(slot.start, zone);
    const last = days[days.length - 1];
    if (last?.key === key) last.slots.push(slot);
    else days.push({ key, slots: [slot] });
  }
  return days;
}

const DONE: Record<Done, string> = {
  booked: "You're booked. A calendar invite with the video link is on its way to your email.",
  rescheduled: "Your interview was moved. The calendar invite has been updated.",
  cancelled: "Your interview was cancelled. You can pick a new time below while this link is open.",
};

const joinNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * IVT-063 (IV-REQ-021/022): the candidate picks, moves or cancels their
 * interview. Times show in the browser's zone, which they can change. Shows
 * interviewers by name only (IV-SEC-003).
 */
export default function SelfSchedule({ token, link, slots }: { token: string; link: PublicLink; slots: Slot[] }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(selfScheduleReducer, initialSelfSchedule(link.status, "UTC"));
  const zones = useMemo(() => timeZoneOptions(state.zone), [state.zone]);
  const action = pendingAction(state);

  useEffect(() => {
    const zone = browserTimeZone();
    if (zone) dispatch({ type: "zone", zone });
  }, []);

  const submit = async () => {
    if (!action) return;
    dispatch({ type: "submit" });
    try {
      const res = await fetch(`/api/schedule/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "cancel"
            ? { action }
            : { action, startsAt: state.slot!.start, ...(action === "book" ? { timeZone: state.zone } : {}) },
        ),
      });
      const result = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string; error?: string } | null;
      if (result?.ok) {
        dispatch({ type: "succeeded", done: action === "book" ? "booked" : action === "reschedule" ? "rescheduled" : "cancelled" });
        router.refresh();
      } else {
        const reason = result?.reason ?? "error";
        dispatch({ type: "failed", reason, error: result?.error ?? selfSchedulingMessage(reason) });
        if (reason === "slot_taken") router.refresh();
      }
    } catch {
      dispatch({ type: "failed", reason: "error", error: selfSchedulingMessage("error") });
    }
  };

  const booked = link.status === "scheduled" && link.starts_at;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          {[link.company_name, link.job_title].filter(Boolean).join(" · ")}
        </p>
        <h1 className="text-2xl font-semibold">{link.interview_name}</h1>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="size-4" aria-hidden />
          {link.duration_minutes} minutes
          {link.interviewers.length > 0 && <> · with {joinNames(link.interviewers)}</>}
        </p>
      </header>

      {state.done && (
        <p role="status" className="rounded-lg border px-3 py-2 text-sm">
          {DONE[state.done]}
        </p>
      )}

      {state.mode !== "pick" && booked && (
        <section className="flex flex-col gap-3 rounded-lg border p-4" aria-label="Your interview">
          <p className="flex items-center gap-2 font-semibold">
            <CalendarCheck className="size-4" aria-hidden />
            {fullLabel(link.starts_at!, state.zone)}
          </p>
          {link.meeting_url && (
            <a
              href={link.meeting_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm underline underline-offset-4"
            >
              <Video className="size-4" aria-hidden />
              Join the video call
            </a>
          )}
          {state.mode === "confirm_cancel" ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">Cancel this interview? You can pick a new time afterwards while this link is open.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={submit} disabled={state.submitting}>
                  {state.submitting ? "Cancelling…" : "Cancel interview"}
                </Button>
                <Button variant="outline" onClick={() => dispatch({ type: "back" })} disabled={state.submitting}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : link.can_change ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => dispatch({ type: "reschedule" })}>
                Pick another time
              </Button>
              <Button variant="ghost" onClick={() => dispatch({ type: "ask_cancel" })}>
                Cancel
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{selfSchedulingMessage("too_late")}</p>
          )}
        </section>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="schedule-zone">Times shown in</Label>
        <Select value={state.zone} onValueChange={(zone) => dispatch({ type: "zone", zone })}>
          <SelectTrigger id="schedule-zone" aria-label="Time zone" className="w-full max-w-xs">
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

      {state.mode === "pick" && (
        <section className="flex flex-col gap-4" aria-label="Pick a time">
          <h2 className="font-semibold">{link.status === "scheduled" ? "Pick a new time" : "Pick a time"}</h2>
          {slots.length === 0 ? (
            <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
              No times are open right now. Check back later, or reply to the company&apos;s email.
            </p>
          ) : (
            <div className="flex flex-col gap-4" role="list" aria-label="Open times">
              {byDay(slots, state.zone).map((day) => (
                <div key={day.key} role="listitem" className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">{dayLabel(day.slots[0].start, state.zone)}</p>
                  <div className="flex flex-wrap gap-2">
                    {day.slots.map((slot) => {
                      const picked = state.slot?.start === slot.start;
                      return (
                        <Button
                          key={slot.start}
                          type="button"
                          size="sm"
                          variant={picked ? "brand" : "outline"}
                          aria-pressed={picked}
                          onClick={() => dispatch({ type: "pick", slot })}
                        >
                          {timeLabel(slot.start, state.zone)}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="brand" onClick={submit} disabled={!state.slot || state.submitting}>
              {state.submitting
                ? "Saving…"
                : state.slot
                  ? `${link.status === "scheduled" ? "Move to" : "Book"} ${fullLabel(state.slot.start, state.zone)}`
                  : "Pick a time"}
            </Button>
            {link.status === "scheduled" && (
              <Button variant="outline" onClick={() => dispatch({ type: "back" })} disabled={state.submitting}>
                Back
              </Button>
            )}
          </div>
        </section>
      )}

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </div>
  );
}
