"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { saveTemplateAction } from "@/app/actions/pipeline/save-template";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_TEMPLATE_BODY,
  MAX_TEMPLATE_SUBJECT,
  TEMPLATE_VARIABLES,
  renderTemplate,
  type TemplateVars,
} from "@/helpers/pipeline/templates";
import { cn } from "@/utils/utils";

type Template = { id: string; purpose: string; name: string; subject: string; body_md: string };

const PURPOSE_LABELS: Record<string, string> = {
  rejection: "Rejection",
  advance: "Next steps",
  interview_invite: "Interview invite",
  offer: "Offer",
  custom: "Custom message",
};

function Counter({ length, max }: { length: number; max: number }) {
  return (
    <span className={cn("text-xs text-muted-foreground", length > max && "text-destructive")}>
      {length.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
    </span>
  );
}

/**
 * Company settings: the email templates (PL-TASK-032, PL-REQ-007). One
 * template per purpose, with variable chips that insert at the cursor, length
 * counters and a live preview rendered with sample values by the same
 * whitelist renderer the send uses.
 */
export default function TemplateEditor({
  templates: initial,
  sampleVars,
}: {
  templates: Template[];
  /** Example values for the preview: the company's own name and scheduling link. */
  sampleVars: TemplateVars;
}) {
  const [templates, setTemplates] = useState(initial);
  const [selectedId, setSelectedId] = useState(initial[0]?.id ?? "");
  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const [name, setName] = useState(selected?.name ?? "");
  const [subject, setSubject] = useState(selected?.subject ?? "");
  const [body, setBody] = useState(selected?.body_md ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const select = (id: string) => {
    const next = templates.find((t) => t.id === id);
    if (!next) return;
    setSelectedId(id);
    setName(next.name);
    setSubject(next.subject);
    setBody(next.body_md);
  };

  const insert = (variable: string) => {
    const el = messageRef.current;
    const token = `{{${variable}}}`;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const rendered = subject.trim() && body.trim() ? renderTemplate({ subject, body_md: body }, sampleVars) : null;
  const unknown = rendered?.ok ? rendered.unknownVariables : [];
  const missing = rendered?.ok ? rendered.missingVariables : [];
  const fits =
    name.trim().length >= 1 &&
    name.length <= 60 &&
    subject.trim().length >= 1 &&
    subject.length <= MAX_TEMPLATE_SUBJECT &&
    body.trim().length >= 1 &&
    body.length <= MAX_TEMPLATE_BODY;

  const save = async () => {
    if (!selected) return;
    setIsSaving(true);
    try {
      const result = await saveTemplateAction({ templateId: selected.id, name, subject, body });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setTemplates((current) =>
        current.map((t) => (t.id === selected.id ? { ...t, name, subject, body_md: body } : t)),
      );
      toast.success("Template saved.");
    } catch {
      toast.error("Couldn't save the template. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!selected) return <p className="text-sm text-muted-foreground">No templates yet.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <Select value={selectedId} onValueChange={select}>
          <SelectTrigger aria-label="Template">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {PURPOSE_LABELS[t.purpose] ?? t.purpose}: {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-col gap-1">
          <Label htmlFor="template-name">Name</Label>
          <Input id="template-name" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="template-subject">Subject</Label>
            <Counter length={subject.length} max={MAX_TEMPLATE_SUBJECT} />
          </div>
          <Input
            id="template-subject"
            aria-label="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="template-body">Message</Label>
            <Counter length={body.length} max={MAX_TEMPLATE_BODY} />
          </div>
          <Textarea
            id="template-body"
            aria-label="Message"
            ref={messageRef}
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap gap-1">
            {TEMPLATE_VARIABLES.map((v) => (
              <Button
                key={v}
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 font-mono text-xs"
                aria-label={`Insert {{${v}}}`}
                onClick={() => insert(v)}
              >
                {`{{${v}}}`}
              </Button>
            ))}
          </div>
        </div>

        {unknown.length > 0 && (
          <p role="alert" className="text-sm text-destructive">
            Unknown variable{unknown.length === 1 ? "" : "s"}: {unknown.map((v) => `{{${v}}}`).join(", ")}
          </p>
        )}

        <div>
          <Button disabled={!fits || unknown.length > 0 || isSaving} onClick={() => void save()}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save template
          </Button>
        </div>
      </div>

      <section aria-label="Preview" className="rounded-lg border px-4 py-3 text-sm">
        <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Preview</p>
        {rendered === null ? (
          <p className="text-muted-foreground">Add a subject and a message.</p>
        ) : rendered.ok ? (
          <>
            <p className="font-medium">{rendered.subject}</p>
            <div className="prose prose-sm mt-2 max-w-none break-words dark:prose-invert">
              <ReactMarkdown components={{ img: () => null }}>{rendered.body}</ReactMarkdown>
            </div>
            {missing.includes("scheduling_link") && (
              <p className="mt-2 text-xs text-muted-foreground">
                Add a scheduling link below, or emails using this template can&apos;t be sent.
              </p>
            )}
          </>
        ) : (
          <p className="text-destructive">{rendered.error}</p>
        )}
      </section>
    </div>
  );
}
