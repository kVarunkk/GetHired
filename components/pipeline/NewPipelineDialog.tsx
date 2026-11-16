"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlusCircle } from "lucide-react";
import { createPipelineAction } from "@/app/actions/pipeline/create-pipeline";
import AgentHandoff from "@/components/agent/AgentHandoff";
import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { jobPipelineSwitchPath } from "@/helpers/jobs/paths";
import { MAX_PIPELINES_PER_COMPANY, PIPELINE_NAME_MAX, pipelineEditorPath } from "@/helpers/pipeline/config";

export type NewPipelineSource = { id: string; name: string; isDefault: boolean };
type Source = NewPipelineSource;

export const PIPELINE_LIMIT_REACHED = `A company can have at most ${MAX_PIPELINES_PER_COMPANY} pipelines. Archive one first.`;

/** The handoff's prompt: the typed description, for createPipeline and the stage tools. */
export const newPipelinePrompt = (text: string) =>
  `Create a new pipeline: ${text.trim()}. Copy the closest of my pipelines, then set up its stages and show me before changing them.`;

/**
 * "New pipeline" (JPT-032, JP-REQ-005): a name and the pipeline to copy the
 * stages from, the default one preselected, so the new one always has the
 * protected kinds. Opens the new pipeline's stage editor. With agent.use, an
 * AgentHandoff hands the description to the agent's createPipeline tool.
 *
 * With `forJobId` (the "New pipeline…" item on a job's "Change pipeline"
 * page) it copies `initialSourceId` by default and returns to that page with
 * the new pipeline picked, instead of opening the editor. Passing `open`
 * makes it controlled, with no trigger button; the caller remounts it (a
 * `key`) to clear the fields.
 */
export default function NewPipelineDialog({
  sources,
  atLimit,
  canUseAgent = false,
  forJobId,
  initialSourceId,
  open: controlledOpen,
  onOpenChange: onControlledOpenChange,
}: {
  sources: Source[];
  atLimit: boolean;
  canUseAgent?: boolean;
  forJobId?: string;
  initialSourceId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const defaultSource =
    sources.find((s) => s.id === initialSourceId) ?? sources.find((s) => s.isDefault) ?? sources[0];
  const controlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => (controlled ? onControlledOpenChange?.(next) : setUncontrolledOpen(next));
  const [name, setName] = useState("");
  const [fromId, setFromId] = useState(defaultSource?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName("");
      setFromId(defaultSource?.id ?? "");
      setError(null);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await createPipelineAction({ name: name.trim(), ...(fromId ? { fromPipelineId: fromId } : {}) });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push(
        forJobId ? jobPipelineSwitchPath(forJobId, { to: result.pipelineId }) : pipelineEditorPath(result.pipelineId),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!controlled && (
        <Button
          variant="brand"
          disabled={atLimit}
          title={atLimit ? PIPELINE_LIMIT_REACHED : undefined}
          onClick={() => onOpenChange(true)}
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          New pipeline
        </Button>
      )}
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>New pipeline</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {forJobId
                ? "It starts as a copy of another pipeline's stages. Next, pick where this job's candidates go. You can edit the stages any time."
                : "It starts as a copy of another pipeline's stages. You can change them next."}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="grid gap-4">
            {canUseAgent && (
              <AgentHandoff
                label="Or describe the pipeline"
                placeholder="Engineering: Screen, Take-home, Tech interview, Onsite…"
                basePath={COMPANY_AGENT_PATH}
                toPrompt={newPipelinePrompt}
                onHandoff={() => setOpen(false)}
              />
            )}
            <div className="grid gap-2">
              <Label htmlFor="new-pipeline-name">Name</Label>
              <Input
                id="new-pipeline-name"
                placeholder="Engineering"
                value={name}
                maxLength={PIPELINE_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-pipeline-source">Copy stages from</Label>
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger id="new-pipeline-source" aria-label="Copy stages from">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.isDefault ? `${s.name} (default)` : s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button variant="brand" disabled={busy || !name.trim()} onClick={() => void create()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create pipeline
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
