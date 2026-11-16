"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import toast from "react-hot-toast";
import { Loader2, MoreHorizontal } from "lucide-react";
import { archivePipelineAction } from "@/app/actions/pipeline/archive-pipeline";
import { renamePipelineAction } from "@/app/actions/pipeline/rename-pipeline";
import { setDefaultPipelineAction } from "@/app/actions/pipeline/set-default-pipeline";
import ConfirmDialog from "@/components/ConfirmDialog";
import DataTable from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { PIPELINE_NAME_MAX, pipelineEditorPath } from "@/helpers/pipeline/config";
import { pipelineReasonCopy } from "@/helpers/pipeline/copy";

export type PipelineRow = {
  id: string;
  name: string;
  isDefault: boolean;
  /** Jobs on it, open and closed (JP-REQ-008). */
  jobs: number;
  activeStages: number;
};

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Why a pipeline can't be archived, or null when it can (the RPC checks again). */
export function archiveBlockedReason(pipeline: Pick<PipelineRow, "isDefault" | "jobs">): string | null {
  if (pipeline.isDefault) return pipelineReasonCopy("is_default");
  if (pipeline.jobs > 0) return pipelineReasonCopy("in_use", { jobs: pipeline.jobs });
  return null;
}

/**
 * Settings → Pipelines (JPT-032, JP-REQ-001/008): each pipeline with its
 * Default badge, how many jobs use it and its stage count. The row actions
 * (rename, make default, archive) only with settings.stages.
 */
export default function PipelinesTable({ pipelines, canManage }: { pipelines: PipelineRow[]; canManage: boolean }) {
  const columns: ColumnDef<PipelineRow>[] = [
    {
      id: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <Link
            href={pipelineEditorPath(row.original.id)}
            className="block max-w-80 truncate font-medium underline-offset-4 hover:text-brand hover:underline"
          >
            {row.original.name}
          </Link>
          {row.original.isDefault && (
            <Badge variant="outline" title="New jobs get this pipeline.">
              Default
            </Badge>
          )}
        </span>
      ),
    },
    {
      id: "jobs",
      header: "Used by",
      cell: ({ row }) => plural(row.original.jobs, "job"),
      meta: { className: "text-muted-foreground" },
    },
    {
      id: "stages",
      header: "Stages",
      cell: ({ row }) => plural(row.original.activeStages, "stage"),
      meta: { className: "text-muted-foreground" },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href={pipelineEditorPath(row.original.id)}>{canManage ? "Edit stages" : "View"}</Link>
          </Button>
          {canManage && <PipelineRowActions pipeline={row.original} />}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      aria-label="Pipelines"
      data={pipelines}
      columns={columns}
      noun="pipelines"
      emptyMessage="No pipelines yet."
      getRowId={(pipeline) => pipeline.id}
    />
  );
}

function PipelineRowActions({ pipeline }: { pipeline: PipelineRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const archiveBlocked = archiveBlockedReason(pipeline);

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(success);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${pipeline.name}`} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
          {!pipeline.isDefault && (
            <DropdownMenuItem
              onSelect={() =>
                void run(
                  () => setDefaultPipelineAction({ pipelineId: pipeline.id }),
                  `New jobs now get ${pipeline.name}.`,
                )
              }
            >
              Make default
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={archiveBlocked !== null}
            title={archiveBlocked ?? undefined}
            className="text-destructive focus:text-destructive"
            onSelect={() => setArchiving(true)}
          >
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {renaming && <RenamePipelineDialog pipeline={pipeline} onClose={() => setRenaming(false)} />}
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive ${pipeline.name}?`}
        description="It's removed from this list and can't be picked for jobs. No job uses it, so no candidate moves."
        confirmLabel="Archive"
        onConfirm={() => run(() => archivePipelineAction({ pipelineId: pipeline.id }), `${pipeline.name} archived.`)}
      />
    </>
  );
}

/** Mounted only while open, so each opening starts from the current name. */
function RenamePipelineDialog({ pipeline, onClose }: { pipeline: PipelineRow; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(pipeline.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await renamePipelineAction({ pipelineId: pipeline.id, name: name.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Pipeline renamed.");
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Rename {pipeline.name}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Jobs on this pipeline keep it; only the name changes.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="grid gap-2">
          <Label htmlFor="rename-pipeline">Name</Label>
          <Input
            id="rename-pipeline"
            value={name}
            maxLength={PIPELINE_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !name.trim() || name.trim() === pipeline.name} onClick={() => void save()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
