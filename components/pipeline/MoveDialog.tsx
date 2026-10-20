"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Loader2 } from "lucide-react";
import { previewEmailAction, type PreviewEmailResult } from "@/app/actions/pipeline/preview-email";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { MoveEmail } from "@/helpers/pipeline/move";
import type { PipelineStageKind } from "@/helpers/pipeline/status-map";
import {
  TEMPLATE_VARIABLES,
  purposeForKind,
  purposeForMove,
  renderTemplate,
  type TemplateVars,
} from "@/helpers/pipeline/templates";
import { candidateStatusLabel, type StageOption } from "./StagePicker";

export type TemplateOption = {
  id: string;
  purpose: string;
  name: string;
  subject: string;
  body_md: string;
  is_default: boolean;
};

const plural = (n: number) => `${n} application${n === 1 ? "" : "s"}`;
const PREVIEW_DELAY_MS = 300;

// Every known variable filled, so only unknown ones are reported while typing.
const PLACEHOLDERS = Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v, v])) as TemplateVars;

type Props = {
  open: boolean;
  count: number;
  stage: StageOption | null;
  /** Whether the move changes what the candidates see; turns the email on by default. */
  changesStatus: boolean;
  templates: TemplateOption[];
  /** The first selected application, whose candidate fills the preview. */
  previewApplicationId: string | null;
  /** Each application's current stage kind, which picks the suggested template with the target. */
  fromKinds?: (PipelineStageKind | null)[];
  /** How many of them have an open AI interview invite, which a move to Rejected or Hired cancels. */
  openInterviews?: number;
  isMoving?: boolean;
  onConfirm: (email?: MoveEmail) => void;
  onCancel: () => void;
};

/**
 * Confirms a move (PL-REQ-004, PL-TASK-031): the stage, the status the
 * candidates will see and, optionally, an email from one of the company's
 * templates, editable and previewed with a real candidate's values. The
 * suggested template follows where the candidates come from as well as where
 * they go (`purposeForMove`). Nothing is sent while unknown variables remain.
 */
export default function MoveDialog(props: Props) {
  const { open, stage, onCancel } = props;
  return (
    <ResponsiveDialog open={open && stage !== null} onOpenChange={(next) => !next && onCancel()}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        {/* Keyed, so each opening starts from the stage's default template. */}
        {open && stage && <MoveDialogBody key={stage.id} {...props} stage={stage} />}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function MoveDialogBody({
  count,
  stage,
  changesStatus,
  templates,
  previewApplicationId,
  fromKinds = [],
  openInterviews = 0,
  isMoving = false,
  onConfirm,
  onCancel,
}: Props & { stage: StageOption }) {
  // One purpose when every application comes from a stage that suggests the
  // same one; otherwise the target's, with a note to check the wording.
  const purposes = new Set(fromKinds.map((from) => purposeForMove(from, stage.kind)));
  const mixed = purposes.size > 1;
  const purpose = purposes.size === 1 ? [...purposes][0] : purposeForKind(stage.kind);
  const cancelsInterviews = (stage.kind === "rejected" || stage.kind === "hired") && openInterviews > 0;
  const choices = useMemo(
    () => [
      ...templates.filter((t) => t.purpose === purpose),
      ...(purpose === "custom" ? [] : templates.filter((t) => t.purpose === "custom")),
    ],
    [templates, purpose],
  );
  const initial = choices.find((t) => t.purpose === purpose && t.is_default) ?? choices[0] ?? null;

  const [emailOn, setEmailOn] = useState(changesStatus && initial !== null);
  const [templateId, setTemplateId] = useState(initial?.id ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body_md ?? "");
  const [preview, setPreview] = useState<PreviewEmailResult | null>(null);

  const template = choices.find((t) => t.id === templateId) ?? null;

  const pick = (id: string) => {
    const next = choices.find((t) => t.id === id);
    if (!next) return;
    setTemplateId(next.id);
    setSubject(next.subject);
    setBody(next.body_md);
  };

  // Checked locally on every keystroke, so the send button never lags behind.
  const local = renderTemplate({ subject, body_md: body }, PLACEHOLDERS);
  const unknown = local.ok ? local.unknownVariables : [];

  useEffect(() => {
    if (!emailOn || !previewApplicationId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      previewEmailAction({ applicationId: previewApplicationId, subject, body })
        .then((result) => !cancelled && setPreview(result))
        .catch(() => !cancelled && setPreview({ ok: false, error: "Couldn't preview this email." }));
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [emailOn, previewApplicationId, subject, body]);

  const missing = preview?.ok ? preview.missingVariables : [];
  const canSend =
    template !== null && local.ok && unknown.length === 0 && missing.length === 0 && !isMoving;

  const confirm = () => {
    if (!emailOn) return onConfirm(undefined);
    if (!template) return;
    const edited = subject !== template.subject || body !== template.body_md;
    onConfirm(edited ? { templateId: template.id, overrides: { subject, body } } : { templateId: template.id });
  };

  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>
          Move {plural(count)} to {stage.name}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          The candidate will see:{" "}
          <span className="font-medium capitalize text-foreground">{candidateStatusLabel(stage.kind)}</span>
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      <ResponsiveDialogBody className="flex flex-col gap-4">
        {cancelsInterviews && (
          <p className="text-sm text-muted-foreground">
            {count === 1
              ? "Their open AI interview invite will be cancelled, and the held interview minutes released."
              : `${openInterviews} open AI interview invite${openInterviews === 1 ? "" : "s"} will be cancelled, and the held interview minutes released.`}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Switch
            id="move-email"
            aria-label="Email candidates"
            checked={emailOn}
            disabled={choices.length === 0}
            onCheckedChange={setEmailOn}
          />
          <Label htmlFor="move-email">Email candidates</Label>
          {choices.length === 0 && (
            <span className="text-xs text-muted-foreground">No templates for this stage yet.</span>
          )}
        </div>

        {emailOn && (
          <div className="flex flex-col gap-3">
            {mixed && (
              <p className="text-sm text-muted-foreground">
                These applications come from different stages. Check that the message suits all of them.
              </p>
            )}
            <Select value={templateId} onValueChange={pick}>
              <SelectTrigger aria-label="Template">
                <SelectValue placeholder="Choose a template" />
              </SelectTrigger>
              <SelectContent>
                {choices.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <Textarea aria-label="Message" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />

            {!local.ok && <p className="text-sm text-destructive">{local.error}</p>}
            {unknown.length > 0 && (
              <p role="alert" className="text-sm text-destructive">
                Unknown variable{unknown.length === 1 ? "" : "s"}: {unknown.map((v) => `{{${v}}}`).join(", ")}
              </p>
            )}
            {missing.includes("scheduling_link") && (
              <p className="text-sm text-destructive">
                Add a scheduling link in Settings, or remove {"{{scheduling_link}}"}.
              </p>
            )}

            <section aria-label="Preview" className="rounded-lg border px-4 py-3 text-sm">
              {preview === null ? (
                <p className="text-muted-foreground">Preparing the preview…</p>
              ) : preview.ok ? (
                <>
                  <p className="font-medium">{preview.subject}</p>
                  <div className="prose prose-sm mt-2 max-w-none break-words dark:prose-invert">
                    <ReactMarkdown components={{ img: () => null }}>{preview.body}</ReactMarkdown>
                  </div>
                </>
              ) : (
                <p className="text-destructive">{preview.error}</p>
              )}
            </section>
          </div>
        )}
      </ResponsiveDialogBody>

      <ResponsiveDialogFooter className="gap-2">
        <Button variant="outline" disabled={isMoving} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="brand" disabled={emailOn ? !canSend : isMoving} onClick={confirm}>
          {isMoving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {emailOn ? `Move and email ${count}` : "Move"}
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
}
