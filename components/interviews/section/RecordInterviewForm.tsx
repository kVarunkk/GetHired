"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import MemberPicker, { type MemberOption } from "@/components/interviews/MemberPicker";
import StickyActionBar from "@/components/StickyActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { recordInterviewAction } from "@/app/actions/interviews/record-interview";
import { PLAN_LIMITS } from "@/helpers/interviews/config";
import { recordInterviewSchema } from "@/helpers/interviews/interview-schema";
import { localInputToIso } from "./interview-view";

export type RecordPlanItem = {
  id: string;
  name: string;
  stageName: string;
  durationMinutes: number;
  defaultInterviewerIds: string[];
  /** Already scheduled or waiting for the candidate. Only a past time can still be recorded for it. */
  scheduled?: boolean;
};

/** Radix SelectItem can't have an empty value. */
const AD_HOC = "__ad_hoc__";

type RecordFormProps = {
  applicationId: string;
  planItems: RecordPlanItem[];
  members: MemberOption[];
};

/**
 * "Record interview" (IVT-020, IV-REQ-020 manual): an interview arranged
 * outside GetHired, from the job's plan or ad hoc. Nobody is emailed and
 * nothing goes on a calendar. A past time records it as completed. It's the
 * schedule page's form with the calendar off, and the scheduler's "Record
 * manually" tab with it on (IVT-045). `backHref`: the Interviews section.
 */
export function RecordInterviewForm({
  applicationId,
  planItems,
  members,
  backHref,
  onBusyChange,
}: RecordFormProps & {
  backHref: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const first = planItems.find((p) => !p.scheduled);
  const [planItemId, setPlanItemId] = useState<string>(first?.id ?? AD_HOC);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState<number>(PLAN_LIMITS.durationDefault);
  const [panel, setPanel] = useState<string[]>(first?.defaultInterviewerIds ?? []);
  const [startsAt, setStartsAt] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [busy, setBusyState] = useState(false);
  const setBusy = (next: boolean) => {
    setBusyState(next);
    onBusyChange?.(next);
  };
  const [error, setError] = useState<string | null>(null);
  const adHoc = planItemId === AD_HOC;

  const pickItem = (id: string) => {
    setPlanItemId(id);
    const item = planItems.find((p) => p.id === id);
    // Prefill the plan's default interviewers, keeping anyone already picked.
    if (item && panel.length === 0) setPanel(item.defaultInterviewerIds);
  };

  const submit = async () => {
    const input = {
      applicationId,
      planItemId: adHoc ? null : planItemId,
      name: adHoc ? name : null,
      durationMinutes: adHoc ? duration : null,
      panel,
      startsAt: localInputToIso(startsAt) ?? "",
      meetingUrl: meetingUrl.trim() || null,
    };
    const parsed = recordInterviewSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await recordInterviewAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.status === "completed" ? "Interview recorded as completed." : "Interview recorded.");
      router.push(backHref);
      router.refresh();
    } catch {
      setError("Couldn't record the interview. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:max-w-2xl">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="record-plan-item">Interview</Label>
          <Select value={planItemId} onValueChange={pickItem}>
            <SelectTrigger id="record-plan-item" aria-label="Interview">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {planItems.map((p) => (
                <SelectItem key={p.id} value={p.id}>
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
              <Label htmlFor="record-name">Name</Label>
              <Input
                id="record-name"
                value={name}
                maxLength={PLAN_LIMITS.name}
                placeholder="e.g. Coffee chat"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex w-32 flex-col gap-1.5">
              <Label htmlFor="record-duration">Minutes</Label>
              <Input
                id="record-duration"
                type="number"
                min={PLAN_LIMITS.durationMin}
                max={PLAN_LIMITS.durationMax}
                step={5}
                value={Number.isFinite(duration) ? duration : ""}
                onChange={(e) => setDuration(e.target.valueAsNumber)}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="record-panel">Interviewers</Label>
          <MemberPicker id="record-panel" members={members} value={panel} onChange={setPanel} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="record-starts">Starts</Label>
          <Input
            id="record-starts"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="record-url">Meeting link (optional)</Label>
          <Input
            id="record-url"
            type="url"
            value={meetingUrl}
            placeholder="https://"
            onChange={(e) => setMeetingUrl(e.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <StickyActionBar className="justify-end">
        <Button type="button" variant="outline" disabled={busy} onClick={() => router.push(backHref)}>
          Cancel
        </Button>
        <Button type="button" variant="brand" disabled={busy} onClick={submit}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Record interview
        </Button>
      </StickyActionBar>
    </div>
  );
}
