"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CalendarX, ExternalLink, Loader2, MoreHorizontal } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import InterviewTime from "@/components/interviews/InterviewTime";
import MemberPicker, { type MemberOption } from "@/components/interviews/MemberPicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cancelInterviewAction } from "@/app/actions/interviews/cancel-interview";
import { markInterviewAction } from "@/app/actions/interviews/mark-interview";
import { updateInterviewAction } from "@/app/actions/interviews/update-interview";
import { renewSchedulingLinkAction } from "@/app/actions/interviews/send-scheduling-link";
import { remindInterviewersAction } from "@/app/actions/interviews/remind-interviewers";
import type { LinkTemplate } from "@/helpers/interviews/scheduling-schema";
import { connectCalendarHref } from "@/helpers/calendar/config";
import type { ApplicationInterview, InterviewStageGroup, PanelSeat } from "@/helpers/interviews/interviews";
import { RATING_LABELS, type CandidateRating } from "@/helpers/pipeline/ratings";
import { cn } from "@/utils/utils";
import {
  STATUS_LABELS,
  STATUS_TONE,
  calendarBanner,
  canCancel,
  canChange,
  canMarkCompleted,
  canMarkNoShow,
  canRemind,
  feedbackCount,
  isoToLocalInput,
  localInputToIso,
  reminderToast,
} from "./interview-view";

const RATINGS = Object.keys(RATING_LABELS) as CandidateRating[];

type EditKind = "reschedule" | "panel" | "cancel" | "resend";
type Edit = { kind: EditKind; interview: ApplicationInterview } | null;

/** Calendar state for the banners (IVT-048); absent while Google Calendar is off. */
export type SectionCalendar = {
  /** `panel_calendar_status` by user id. */
  statuses: Record<string, "connected" | "unknown" | "error">;
  /** Where "Reconnect" comes back to. */
  returnTo: string;
  /** Templates to resend a scheduling link with (IVT-065). */
  templates?: LinkTemplate[];
};

/**
 * The application's interviews with people (IVT-020, IV-REQ-020/033), grouped
 * by the stage they belong to: status, time, panel with each person's
 * scorecard state, and the scorecards as far as blind review allows. Notes
 * stay in the Notes section (D9).
 */
export default function ApplicationInterviews({
  groups,
  members,
  canManage,
  currentUserId,
  calendar,
}: {
  groups: InterviewStageGroup[];
  members: MemberOption[];
  /** `scheduling.manage` on the job, and the application is open and not merged. */
  canManage: boolean;
  currentUserId: string;
  calendar?: SectionCalendar;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<Edit>(null);
  const [now] = useState(() => Date.now());

  const run = async (
    work: () => Promise<{ ok: boolean; error?: string; calendarWarning?: string }>,
    success: string,
  ) => {
    try {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong. Please try again.");
        return false;
      }
      toast.success(success);
      // The change applied; only Google Calendar didn't follow (IVT-044).
      if (result.calendarWarning) toast.error(result.calendarWarning);
      router.refresh();
      return true;
    } catch {
      toast.error("Something went wrong. Please try again.");
      return false;
    }
  };

  // "Copy a new link" (IVT-065): only hashes are stored, so copying makes a
  // new link and the emailed one stops working.
  const copyLink = async (interviewId: string) => {
    try {
      const result = await renewSchedulingLinkAction({ interviewId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      await navigator.clipboard.writeText(result.url);
      toast.success("New link copied. The link in the earlier email no longer works.");
      router.refresh();
    } catch {
      toast.error("Couldn't copy the link. Please try again.");
    }
  };

  // IVT-084: emails the panel members who still owe a scorecard.
  const remind = async (interviewId: string) => {
    try {
      const result = await remindInterviewersAction({ interviewId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { ok, message } = reminderToast(result);
      if (ok) toast.success(message);
      else toast.error(message);
    } catch {
      toast.error("Something went wrong. Please try again.");
    }
  };

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
        No interviews yet.{canManage ? " Record one to give the panel a kit and scorecards." : ""}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.stageId ?? "none"} aria-label={group.stageName} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{group.stageName}</h3>
          {group.interviews.map((interview) => (
            <InterviewCard
              key={interview.id}
              interview={interview}
              canManage={canManage}
              currentUserId={currentUserId}
              now={now}
              calendar={calendar}
              onEdit={(kind) => setEdit({ kind, interview })}
              onCopyLink={() => copyLink(interview.id)}
              onRemind={() => remind(interview.id)}
              onMark={(status) =>
                run(
                  () => markInterviewAction({ interviewId: interview.id, status }),
                  status === "no_show" ? "Marked as a no-show." : "Marked as completed.",
                )
              }
            />
          ))}
        </section>
      ))}

      {edit?.kind === "reschedule" && (
        <RescheduleDialog
          interview={edit.interview}
          onClose={() => setEdit(null)}
          onSave={(startsAt, meetingUrl) =>
            run(
              () =>
                updateInterviewAction({
                  interviewId: edit.interview.id,
                  ...(startsAt ? { startsAt } : {}),
                  ...(meetingUrl !== undefined ? { meetingUrl } : {}),
                }),
              "Interview updated.",
            )
          }
        />
      )}
      {edit?.kind === "panel" && (
        <PanelDialog
          interview={edit.interview}
          members={members}
          onClose={() => setEdit(null)}
          onSave={(panel) =>
            run(() => updateInterviewAction({ interviewId: edit.interview.id, panel }), "Interviewers updated.")
          }
        />
      )}
      {edit?.kind === "resend" && (
        <ResendLinkDialog
          interview={edit.interview}
          templates={calendar?.templates ?? []}
          onClose={() => setEdit(null)}
          onResend={async (templateId) => {
            try {
              const result = await renewSchedulingLinkAction({ interviewId: edit.interview.id, email: { templateId } });
              if (!result.ok) {
                toast.error(result.error);
                return false;
              }
              if (result.emailed) toast.success("Link resent. The earlier link no longer works.");
              else toast.error(result.warning ?? "The email couldn't be sent. Copy the link and send it yourself.");
              router.refresh();
              return true;
            } catch {
              toast.error("Something went wrong. Please try again.");
              return false;
            }
          }}
        />
      )}
      <ConfirmDialog
        open={edit?.kind === "cancel"}
        onOpenChange={(open) => !open && setEdit(null)}
        title="Cancel this interview?"
        description={
          edit?.interview.onCalendar
            ? "The interviewers lose the kit, and draft scorecards stay unsubmitted. The event is removed and Google Calendar emails the attendees."
            : edit?.interview.status === "awaiting_candidate"
              ? "The candidate's link stops working, and the interviewers lose the kit. Nobody is emailed."
              : "The interviewers lose the kit, and draft scorecards stay unsubmitted. Nobody is emailed."
        }
        confirmLabel="Cancel interview"
        onConfirm={() =>
          edit && run(() => cancelInterviewAction({ interviewId: edit.interview.id }), "Interview cancelled.")
        }
      />
    </div>
  );
}

function InterviewCard({
  interview,
  canManage,
  currentUserId,
  now,
  calendar,
  onEdit,
  onCopyLink,
  onRemind,
  onMark,
}: {
  interview: ApplicationInterview;
  canManage: boolean;
  currentUserId: string;
  now: number;
  calendar?: SectionCalendar;
  onEdit: (kind: EditKind) => void;
  onCopyLink: () => void;
  onRemind: () => void;
  onMark: (status: "completed" | "no_show") => void;
}) {
  const scoring = interview.status !== "cancelled" && interview.status !== "no_show";
  const onPanel = interview.panel.some((p) => p.userId === currentUserId);
  const remindable = canManage && canRemind(interview, now);
  const actions =
    remindable ||
    (canManage && (canChange(interview) || canMarkCompleted(interview, now) || canMarkNoShow(interview, now)));
  const anyRated = interview.summary.some((s) => RATINGS.some((r) => s.counts[r] > 0));
  const banner = calendar ? calendarBanner(interview, currentUserId, calendar.statuses) : null;
  const waitingOnLink = interview.status === "awaiting_candidate" && interview.source === "link";
  // Links need Google Calendar on (the section gets `calendar` only then).
  const linkActions = canManage && waitingOnLink && !!calendar;

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4" role="group" aria-label={interview.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium [overflow-wrap:anywhere]">{interview.name}</p>
            <Badge variant="outline" className={cn("font-normal", STATUS_TONE[interview.status])}>
              {STATUS_LABELS[interview.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            <InterviewTime startsAt={interview.startsAt} endsAt={interview.endsAt} /> · {interview.durationMinutes} min
          </p>
          {waitingOnLink && (
            <p className="text-sm text-muted-foreground">Waiting for the candidate to pick a time from the link.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onPanel && scoring && (
            <Button asChild variant="outline" size="sm">
              <a href={`/company/interviews/${interview.id}`}>Open kit</a>
            </Button>
          )}
          {interview.meetingUrl && (interview.status === "scheduled" || interview.status === "awaiting_candidate") && (
            <Button asChild variant="outline" size="sm">
              <a href={interview.meetingUrl} target="_blank" rel="noopener noreferrer">
                Join <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
          {actions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${interview.name}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canChange(interview) && interview.status === "scheduled" && (
                  <DropdownMenuItem onSelect={() => onEdit("reschedule")}>Reschedule</DropdownMenuItem>
                )}
                {linkActions && <DropdownMenuItem onSelect={onCopyLink}>Copy a new link</DropdownMenuItem>}
                {linkActions && (calendar?.templates?.length ?? 0) > 0 && (
                  <DropdownMenuItem onSelect={() => onEdit("resend")}>Resend link</DropdownMenuItem>
                )}
                {canChange(interview) && (
                  <DropdownMenuItem onSelect={() => onEdit("panel")}>Change interviewers</DropdownMenuItem>
                )}
                {remindable && <DropdownMenuItem onSelect={onRemind}>Remind interviewers</DropdownMenuItem>}
                {canMarkCompleted(interview, now) && (
                  <DropdownMenuItem onSelect={() => onMark("completed")}>Mark completed</DropdownMenuItem>
                )}
                {canMarkNoShow(interview, now) && (
                  <DropdownMenuItem onSelect={() => onMark("no_show")}>Mark no-show</DropdownMenuItem>
                )}
                {canCancel(interview) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => onEdit("cancel")}
                    >
                      Cancel interview
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {banner && calendar && (
        <Alert>
          <CalendarX className="h-4 w-4" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            {banner === "reconnect" ? (
              <>
                <span>Reconnect your Google Calendar to keep this interview&apos;s event up to date.</span>
                <Button asChild size="sm" variant="outline">
                  <a href={connectCalendarHref(calendar.returnTo)}>Reconnect</a>
                </Button>
              </>
            ) : (
              <span>Organizer disconnected: reschedule to move it to your calendar.</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Scorecards</p>
          {scoring && (
            <p className="text-xs text-muted-foreground">{feedbackCount(interview.submitted, interview.panel.length)}</p>
          )}
        </div>
        <div className="divide-y rounded-lg border">
          {interview.panel.map((seat) => (
            <SeatRow key={seat.userId} seat={seat} competencies={interview.competencies} scoring={scoring} />
          ))}
        </div>
        {interview.hidden > 0 && (
          <p className="text-xs text-muted-foreground">
            Teammates&apos; feedback is hidden until you submit your own scorecard.
          </p>
        )}
      </div>

      {anyRated && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">By competency</p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Competency</th>
                  {RATINGS.map((r) => (
                    <th key={r} className="px-3 py-2 text-right font-medium">
                      {RATING_LABELS[r]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {interview.summary.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2">{s.name}</td>
                    {RATINGS.map((r) => (
                      <td key={r} className="px-3 py-2 text-right tabular-nums">
                        {s.counts[r] || "–"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const SEAT_STATE: Record<PanelSeat["scorecardStatus"], string> = {
  none: "Not started",
  draft: "Draft",
  submitted: "Submitted",
};

function SeatRow({
  seat,
  competencies,
  scoring,
}: {
  seat: PanelSeat;
  competencies: ApplicationInterview["competencies"];
  scoring: boolean;
}) {
  const shown = seat.visible && seat.scorecardStatus === "submitted";
  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{seat.name}</span>
        <span className="flex items-center gap-2 text-muted-foreground">
          {shown && seat.overall && (
            <Badge variant="outline" className="font-normal">
              {RATING_LABELS[seat.overall]}
            </Badge>
          )}
          {scoring && SEAT_STATE[seat.scorecardStatus]}
        </span>
      </div>
      {shown && (
        <div className="flex flex-col gap-1 text-sm">
          {competencies.map((c) => {
            const r = seat.ratings?.[c.id];
            if (!r || (!r.rating && !r.note)) return null;
            return (
              <p key={c.id} className="[overflow-wrap:anywhere]">
                <span className="text-muted-foreground">{c.name}:</span> {r.rating ? RATING_LABELS[r.rating] : "No rating"}
                {r.note && <span className="text-muted-foreground"> · {r.note}</span>}
              </p>
            );
          })}
          {seat.overallNote && (
            <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{seat.overallNote}</p>
          )}
        </div>
      )}
    </div>
  );
}

function RescheduleDialog({
  interview,
  onClose,
  onSave,
}: {
  interview: ApplicationInterview;
  onClose: () => void;
  /** `meetingUrl`: undefined keeps it, "" or null clears it. */
  onSave: (startsAt: string | null, meetingUrl: string | null | undefined) => Promise<boolean>;
}) {
  const [startsAt, setStartsAt] = useState(isoToLocalInput(interview.startsAt));
  const [meetingUrl, setMeetingUrl] = useState(interview.meetingUrl ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const iso = localInputToIso(startsAt);
    const moved = iso && iso !== interview.startsAt ? iso : null;
    const url = meetingUrl.trim();
    const urlChange = url === (interview.meetingUrl ?? "") ? undefined : url || null;
    if (!moved && urlChange === undefined) return onClose();
    setBusy(true);
    const ok = await onSave(moved, urlChange);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule {interview.name}</DialogTitle>
          <DialogDescription>
            {interview.onCalendar
              ? "The Google Calendar event moves too, and Google emails the attendees."
              : "Nobody is emailed. Let the candidate and the panel know yourself."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reschedule-starts">Starts</Label>
            <Input id="reschedule-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reschedule-url">Meeting link</Label>
            <Input
              id="reschedule-url"
              type="url"
              value={meetingUrl}
              placeholder="https://"
              onChange={(e) => setMeetingUrl(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="brand" disabled={busy} onClick={save}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PanelDialog({
  interview,
  members,
  onClose,
  onSave,
}: {
  interview: ApplicationInterview;
  members: MemberOption[];
  onClose: () => void;
  onSave: (panel: string[]) => Promise<boolean>;
}) {
  const [panel, setPanel] = useState(interview.panel.map((p) => p.userId));
  const [busy, setBusy] = useState(false);
  const known = [
    ...members,
    ...interview.panel.filter((p) => !members.some((m) => m.userId === p.userId)).map((p) => ({ userId: p.userId, name: p.name })),
  ];

  const save = async () => {
    setBusy(true);
    const ok = await onSave(panel);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change interviewers</DialogTitle>
          <DialogDescription>
            Someone you remove loses the kit and their draft scorecard. A submitted scorecard is kept.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="panel-picker">Interviewers</Label>
          <MemberPicker id="panel-picker" members={known} value={panel} onChange={setPanel} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="brand" disabled={busy || panel.length === 0} onClick={save}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResendLinkDialog({
  interview,
  templates,
  onClose,
  onResend,
}: {
  interview: ApplicationInterview;
  templates: LinkTemplate[];
  onClose: () => void;
  onResend: (templateId: string) => Promise<boolean>;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const template = templates.find((t) => t.id === templateId);

  const resend = async () => {
    setBusy(true);
    const ok = await onResend(templateId);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resend the link for {interview.name}</DialogTitle>
          <DialogDescription>
            The candidate gets a new link that works for 7 days. The link in the earlier email stops working.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="resend-template">Email template</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger id="resend-template" aria-label="Email template">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {template && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Subject: {template.subject}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="brand" disabled={busy || !template} onClick={resend}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Resend
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
