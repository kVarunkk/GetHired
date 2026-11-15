"use client";

import { useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CalendarClock, Loader2 } from "lucide-react";
import AgentHandoff from "@/components/agent/AgentHandoff";
import { scheduleHandoffPrompt } from "@/components/agent/recruiter/AskAgentAboutInterviews";
import MemberPicker, { type MemberOption } from "@/components/interviews/MemberPicker";
import { RecordInterviewForm } from "@/components/interviews/section/RecordInterviewForm";
import StickyActionBar from "@/components/StickyActionBar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { bookInterviewAction } from "@/app/actions/interviews/book-interview";
import { findInterviewSlotsAction } from "@/app/actions/interviews/find-slots";
import { sendSchedulingLinkAction } from "@/app/actions/interviews/send-scheduling-link";
import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { connectCalendarHref } from "@/helpers/calendar/config";
import { schedulingMessage } from "@/helpers/calendar/copy";
import { PLAN_LIMITS } from "@/helpers/interviews/config";
import { hasSchedulingLink } from "@/helpers/interviews/scheduling-schema";
import { MAX_TEMPLATE_BODY, MAX_TEMPLATE_SUBJECT } from "@/helpers/pipeline/templates";
import type { MemberCalendarStatus } from "@/helpers/interviews/scheduling";
import { cn } from "@/utils/utils";
import {
  AD_HOC,
  canBook,
  canSearch,
  canSendLink,
  initialScheduler,
  linkBlocker,
  schedulerReducer,
  slotsByDay,
  type LinkTemplate,
  type SchedulerPlanItem,
  type SchedulerTab,
} from "./scheduler-machine";

export type SchedulerCalendar = {
  /** The session member's own connection: `null` when they never connected. */
  own: "active" | "error" | null;
  /** `panel_calendar_status` for the team, by user id. */
  members: Record<string, MemberCalendarStatus>;
  /** False when the candidate can't get a calendar invite (D20: no email, or opted out). */
  candidateInvitable: boolean;
};

const BADGE: Record<MemberCalendarStatus, { label: string; className: string }> = {
  connected: { label: "Calendar connected", className: "text-muted-foreground" },
  unknown: { label: "Availability unknown", className: "text-muted-foreground" },
  error: { label: "Calendar needs reconnecting", className: "border-destructive/40 text-destructive" },
};

/** A member's calendar state beside their name in the panel picker (IV-REQ-012). */
export function CalendarBadge({ status }: { status: MemberCalendarStatus }) {
  const { label, className } = BADGE[status];
  return (
    <Badge variant="outline" className={cn("font-normal", className)}>
      {label}
    </Badge>
  );
}

export const CANDIDATE_NOT_INVITED = "This candidate won't get a calendar invite. Send them the time and the link yourself.";

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

type Props = {
  applicationId: string;
  jobPostId: string;
  planItems: SchedulerPlanItem[];
  members: MemberOption[];
  calendar: SchedulerCalendar;
  /** Where "Connect Google Calendar" comes back to: this page. */
  returnTo: string;
  /** The Interviews section, where Cancel and a finished booking go. */
  backHref: string;
  /** Templates for Send link: interview invites first, then custom ones. */
  templates?: LinkTemplate[];
  /** With `agent.use`: a line to hand the booking to the recruiter agent (IVT-086). */
  agentHandoff?: boolean;
};

/**
 * The scheduler (IVT-045, IV-REQ-020), the body of the schedule page: Book on
 * the member's Google Calendar from the panel's open times, Send link
 * (IVT-065) for the candidate to pick one, or Record manually.
 */
export default function InterviewScheduler({
  applicationId,
  jobPostId,
  planItems,
  members,
  calendar,
  returnTo,
  backHref,
  templates = [],
  agentHandoff = false,
}: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    schedulerReducer,
    { planItems, connected: calendar.own === "active", templates },
    initialScheduler,
  );
  const [recordBusy, setRecordBusy] = useState(false);
  const busy = state.submitting || recordBusy;
  const adHoc = state.planItemId === AD_HOC;

  // After a search, the badges show what it found (a member's free/busy can fail).
  const statusOf = (userId: string): MemberCalendarStatus => {
    if (state.search.status === "ready") {
      const found = state.search.members.find((m) => m.userId === userId);
      if (found) return found.status;
    }
    return calendar.members[userId] ?? "unknown";
  };
  const badges = Object.fromEntries(members.map((m) => [m.userId, <CalendarBadge key={m.userId} status={statusOf(m.userId)} />]));
  const unknownNames =
    state.search.status === "ready"
      ? state.search.members
          .filter((m) => m.status !== "connected" || !m.availabilityKnown)
          .map((m) => members.find((x) => x.userId === m.userId)?.name ?? "Former member")
      : [];

  // The interview and the panel: the same for Book and Send link.
  const interviewFields = (prefix: "book" | "link") => (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${prefix}-plan-item`}>Interview</Label>
        <Select
          value={state.planItemId}
          onValueChange={(id) => dispatch({ type: "item", item: planItems.find((p) => p.id === id) ?? null })}
        >
          <SelectTrigger id={`${prefix}-plan-item`} aria-label="Interview">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {planItems.map((p) => (
              <SelectItem key={p.id} value={p.id} disabled={p.scheduled}>
                {p.name} · {p.stageName} · {p.durationMinutes} min
                {p.scheduled && " · already scheduled"}
              </SelectItem>
            ))}
            <SelectItem value={AD_HOC}>Not in the plan (no competencies)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {adHoc && (
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <Label htmlFor={`${prefix}-name`}>Name</Label>
            <Input
              id={`${prefix}-name`}
              value={state.name}
              maxLength={PLAN_LIMITS.name}
              placeholder="e.g. Coffee chat"
              onChange={(e) => dispatch({ type: "name", name: e.target.value })}
            />
          </div>
          <div className="flex w-32 flex-col gap-1.5">
            <Label htmlFor={`${prefix}-duration`}>Minutes</Label>
            <Input
              id={`${prefix}-duration`}
              type="number"
              min={PLAN_LIMITS.durationMin}
              max={PLAN_LIMITS.durationMax}
              step={5}
              value={Number.isFinite(state.durationMinutes) ? state.durationMinutes : ""}
              onChange={(e) => dispatch({ type: "duration", minutes: e.target.valueAsNumber })}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${prefix}-panel`}>Interviewers</Label>
        <MemberPicker
          id={`${prefix}-panel`}
          members={members}
          value={state.panel}
          badges={badges}
          onChange={(panel) => dispatch({ type: "panel", panel })}
        />
      </div>
    </>
  );

  const blocker = linkBlocker(calendar, state.panel);
  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.name ?? "Former member";

  const sendLink = async () => {
    if (!state.templateId) return;
    dispatch({ type: "submit" });
    try {
      const result = await sendSchedulingLinkAction({
        applicationId,
        planItemId: adHoc ? null : state.planItemId,
        name: adHoc ? state.name : null,
        durationMinutes: adHoc ? state.durationMinutes : null,
        panel: state.panel,
        templateId: state.templateId,
        subject: state.subject,
        body: state.body,
      });
      if (!result.ok) {
        dispatch({ type: "failed", error: result.error, reason: result.reason });
        return;
      }
      dispatch({ type: "done" });
      toast.success("Scheduling link sent. The candidate has 7 days to pick a time.");
      router.push(backHref);
      router.refresh();
    } catch {
      dispatch({ type: "failed", error: "Couldn't send the link. Please try again." });
    }
  };

  const search = async () => {
    dispatch({ type: "search" });
    try {
      const result = await findInterviewSlotsAction({
        jobPostId,
        panel: state.panel,
        durationMinutes: state.durationMinutes,
      });
      if (result.ok) dispatch({ type: "found", slots: result.slots, members: result.members });
      else dispatch({ type: "searchFailed", error: result.error });
    } catch {
      dispatch({ type: "searchFailed", error: "Couldn't load the open times. Please try again." });
    }
  };

  const book = async () => {
    if (!state.slot) return;
    dispatch({ type: "submit" });
    try {
      const result = await bookInterviewAction({
        applicationId,
        planItemId: adHoc ? null : state.planItemId,
        name: adHoc ? state.name : null,
        durationMinutes: adHoc ? state.durationMinutes : null,
        panel: state.panel,
        startsAt: state.slot.start,
      });
      if (!result.ok) {
        dispatch({ type: "failed", error: result.error, reason: result.reason });
        return;
      }
      dispatch({ type: "done" });
      toast.success(
        result.candidateInvited
          ? "Interview booked. Google Calendar sent the invites."
          : "Interview booked. The panel got invites; the candidate didn't.",
      );
      router.push(backHref);
      router.refresh();
    } catch {
      dispatch({ type: "failed", error: "Couldn't book the interview. Please try again." });
    }
  };

  return (
    <div className="flex flex-col gap-6">
        {agentHandoff && (
          <AgentHandoff
            label="Or tell the agent what to book"
            placeholder="An hour with Ada and Ben next Tuesday afternoon…"
            basePath={COMPANY_AGENT_PATH}
            toPrompt={(text) => scheduleHandoffPrompt(applicationId, text)}
          />
        )}

        <Tabs value={state.tab} onValueChange={(tab) => dispatch({ type: "tab", tab: tab as SchedulerTab })}>
          <TabsList>
            <TabsTrigger value="book" disabled={busy}>
              Book
            </TabsTrigger>
            <TabsTrigger value="link" disabled={busy}>
              Send link
            </TabsTrigger>
            <TabsTrigger value="record" disabled={busy}>
              Record manually
            </TabsTrigger>
          </TabsList>

          <TabsContent value="book" className="mt-4 flex flex-col gap-6">
            <div className="flex flex-col gap-4 sm:max-w-2xl">
            {calendar.own !== "active" && (
              <Alert>
                <CalendarClock className="h-4 w-4" />
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    {calendar.own === "error"
                      ? "Reconnect your Google Calendar to book interviews."
                      : "Connect your Google Calendar to book interviews."}
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <a href={connectCalendarHref(returnTo)}>
                      {calendar.own === "error" ? "Reconnect Google Calendar" : "Connect Google Calendar"}
                    </a>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {interviewFields("book")}

            {!calendar.candidateInvitable && (
              <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">{CANDIDATE_NOT_INVITED}</p>
            )}

            <div>
              <Button type="button" variant="outline" disabled={!canSearch(state)} onClick={search}>
                {state.search.status === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
                Find times
              </Button>
            </div>

            {state.search.status === "error" && (
              <p role="alert" className="text-sm text-destructive">
                {state.search.error}
              </p>
            )}

            {state.search.status === "ready" && (
              <div className="flex flex-col gap-3">
                {unknownNames.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Availability unknown for {unknownNames.join(", ")}. Check with them before you book.
                  </p>
                )}
                {state.search.slots.length === 0 ? (
                  <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
                    No time suits the whole panel in the next two weeks. Try fewer interviewers or a shorter interview.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3" role="list" aria-label="Open times">
                    {slotsByDay(state.search.slots).map((day) => (
                      <div key={day.day} role="listitem" className="flex flex-col gap-1.5">
                        <p className="text-xs font-medium text-muted-foreground">{dayLabel(day.slots[0].start)}</p>
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
                                {timeLabel(slot.start)}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {state.error && (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            )}

            </div>

            <StickyActionBar className="justify-end">
              <Button type="button" variant="outline" disabled={busy} onClick={() => router.push(backHref)}>
                Cancel
              </Button>
              <Button type="button" variant="brand" disabled={!canBook(state)} onClick={book}>
                {state.submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Book interview
              </Button>
            </StickyActionBar>
          </TabsContent>

          <TabsContent value="link" className="mt-4 flex flex-col gap-6">
            <div className="flex flex-col gap-4 sm:max-w-2xl">
            {interviewFields("link")}

            {blocker && (
              <Alert>
                <CalendarClock className="h-4 w-4" />
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  {blocker.reason === "not_connected" || blocker.reason === "organizer_reconnect" ? (
                    <>
                      <span>
                        {blocker.reason === "organizer_reconnect"
                          ? "Reconnect your Google Calendar to send scheduling links."
                          : "Connect your Google Calendar to send scheduling links."}
                      </span>
                      <Button asChild size="sm" variant="outline">
                        <a href={connectCalendarHref(returnTo)}>
                          {blocker.reason === "organizer_reconnect" ? "Reconnect Google Calendar" : "Connect Google Calendar"}
                        </a>
                      </Button>
                    </>
                  ) : (
                    <span className="flex flex-col gap-1">
                      <span>{schedulingMessage(blocker.reason)}</span>
                      {blocker.userIds.length > 0 && (
                        <span className="text-muted-foreground">Not connected: {blocker.userIds.map(nameOf).join(", ")}.</span>
                      )}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {templates.length === 0 ? (
              <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
                Add an interview invite template with {"{{scheduling_link}}"} in Settings, then send the link with it.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="link-template">Email template</Label>
                  <Select
                    value={state.templateId ?? undefined}
                    onValueChange={(id) => {
                      const template = templates.find((t) => t.id === id);
                      if (template) dispatch({ type: "template", template });
                    }}
                  >
                    <SelectTrigger id="link-template" aria-label="Email template">
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
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="link-subject">Subject</Label>
                  <Input
                    id="link-subject"
                    value={state.subject}
                    maxLength={MAX_TEMPLATE_SUBJECT}
                    onChange={(e) => dispatch({ type: "subject", subject: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="link-body">Message</Label>
                  <Textarea
                    id="link-body"
                    rows={6}
                    value={state.body}
                    maxLength={MAX_TEMPLATE_BODY}
                    onChange={(e) => dispatch({ type: "body", body: e.target.value })}
                  />
                  {hasSchedulingLink(state.body) ? (
                    <p className="text-xs text-muted-foreground">
                      {"{{scheduling_link}}"} becomes the candidate&apos;s own link. It shows the panel&apos;s open
                      times and works for 7 days.
                    </p>
                  ) : (
                    <p className="text-xs text-destructive">{schedulingMessage("needs_link")}</p>
                  )}
                </div>
              </>
            )}

            {state.error && (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            )}

            </div>

            <StickyActionBar className="justify-end">
              <Button type="button" variant="outline" disabled={busy} onClick={() => router.push(backHref)}>
                Cancel
              </Button>
              <Button type="button" variant="brand" disabled={!canSendLink(state, blocker)} onClick={sendLink}>
                {state.submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Send link
              </Button>
            </StickyActionBar>
          </TabsContent>

          <TabsContent value="record" className="mt-4">
            <RecordInterviewForm
              applicationId={applicationId}
              planItems={planItems}
              members={members}
              backHref={backHref}
              onBusyChange={setRecordBusy}
            />
          </TabsContent>
        </Tabs>
    </div>
  );
}
