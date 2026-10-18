"use client";

import KnockoutBadge from "@/components/applications/KnockoutBadge";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import toast from "react-hot-toast";
import { GripVertical, Star } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Over,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { moveApplicationsAction } from "@/app/actions/pipeline/move-applications";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { changesCandidateStatus } from "@/helpers/pipeline/status-map";
import { PostHogEvent } from "@/utils/types";
import type { BoardApplication, BoardStage, PipelineBoardData } from "@/utils/types/pipeline.types";
import { cn } from "@/utils/utils";
import type { MoveEmail } from "@/helpers/pipeline/move";
import MoveDialog, { type TemplateOption } from "./MoveDialog";

type PendingMove = { app: BoardApplication; stage: BoardStage };

/** The stage a drop lands in: a column, or the column of the card under it. */
const stageIdOf = (over: Over | null): string | null =>
  over ? ((over.data.current?.stageId as string | undefined) ?? String(over.id)) : null;

/**
 * A job's Board view (PL-TASK-010, PL-REQ-003): one column per active stage.
 * Cards move by drag, by keyboard (Space, arrows, Space) or, below `md`, from
 * a per-card menu under a stage picker. Moves are optimistic; one the
 * candidate will notice opens `MoveDialog` first.
 */
export default function PipelineBoard({
  jobPostId,
  initial,
  templates = [],
}: {
  jobPostId: string;
  initial: PipelineBoardData;
  /** The company's email templates, for the move dialog. */
  templates?: TemplateOption[];
}) {
  const [board, setBoard] = useState(initial);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const initialCount = useRef(initial.applications.length);
  useEffect(() => {
    posthog.capture(PostHogEvent.PipelineBoardViewed, { applications: initialCount.current });
  }, []);

  const stageById = useMemo(() => new Map(board.stages.map((s) => [s.id, s])), [board.stages]);
  const appById = useMemo(
    () => new Map(board.applications.map((a) => [a.id, a])),
    [board.applications],
  );
  const cardsIn = (stageId: string) => board.applications.filter((a) => a.stageId === stageId);

  const replaceApp = (app: BoardApplication) =>
    setBoard((b) => ({
      ...b,
      applications: b.applications.map((a) => (a.id === app.id ? app : a)),
    }));

  const refetch = async () => {
    try {
      const response = await fetch(`/api/company/job-posts/${jobPostId}/pipeline`);
      if (response.ok) setBoard((await response.json()) as PipelineBoardData);
    } catch {
      // The optimistic state stays; the next visit reloads it.
    }
  };

  const commit = async ({ app, stage }: PendingMove, email?: MoveEmail) => {
    setPending(null);
    replaceApp({ ...app, stageId: stage.id, daysInStage: 0 });
    try {
      const result = await moveApplicationsAction({
        applicationIds: [app.id],
        stageId: stage.id,
        ...(email ? { email } : {}),
      });
      if (!result.ok) {
        replaceApp(app);
        toast.error(result.error);
      } else if (result.moved === 0 && result.skipped.some((s) => s.reason === "not_found")) {
        replaceApp(app);
        toast.error("Application not found.");
      } else {
        if (result.skipped.some((s) => s.reason === "email_failed")) {
          toast.error(`Moved ${app.name}, but the email couldn't be sent.`);
        } else if (result.emailed > 0) {
          toast.success(`Moved ${app.name} and emailed them.`);
        }
        void refetch();
      }
    } catch {
      replaceApp(app);
      toast.error("Couldn't move the application. Please try again.");
    }
  };

  const requestMove = (appId: string, stageId: string | null) => {
    const app = appById.get(appId);
    const stage = stageId ? stageById.get(stageId) : undefined;
    if (!app || !stage || app.stageId === stage.id) return;
    const fromKind = (app.stageId && stageById.get(app.stageId)?.kind) || null;
    if (changesCandidateStatus(fromKind, stage.kind)) setPending({ app, stage });
    else void commit({ app, stage });
  };

  const dialog = (
    <MoveDialog
      open={pending !== null}
      count={1}
      stage={pending?.stage ?? null}
      changesStatus
      templates={templates}
      previewApplicationId={pending?.app.id ?? null}
      onConfirm={(email) => pending && void commit(pending, email)}
      onCancel={() => setPending(null)}
    />
  );

  if (!isDesktop) {
    return (
      <>
        <MobileBoard board={board} cardsIn={cardsIn} onMove={requestMove} />
        {dialog}
      </>
    );
  }

  return (
    <>
      <DesktopBoard
        board={board}
        cardsIn={cardsIn}
        appName={(id) => appById.get(id)?.name ?? "Application"}
        stageName={(id) => (id && stageById.get(id)?.name) || null}
        onMove={requestMove}
      />
      {dialog}
    </>
  );
}

type BoardProps = {
  board: PipelineBoardData;
  cardsIn: (stageId: string) => BoardApplication[];
  onMove: (appId: string, stageId: string | null) => void;
};

function DesktopBoard({
  board,
  cardsIn,
  appName,
  stageName,
  onMove,
}: BoardProps & {
  appName: (id: string) => string;
  stageName: (id: string | null) => string | null;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${appName(String(active.id))}.`,
    onDragOver: ({ active, over }) => {
      const stage = stageName(stageIdOf(over));
      return stage ? `${appName(String(active.id))} is over ${stage}.` : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const stage = stageName(stageIdOf(over));
      return stage
        ? `${appName(String(active.id))} was dropped in ${stage}.`
        : `${appName(String(active.id))} was dropped.`;
    },
    onDragCancel: ({ active }) => `Moving ${appName(String(active.id))} was cancelled.`,
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => onMove(String(active.id), stageIdOf(over));

  return (
    <DndContext
      id="pipeline-board"
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To move an application, press Space or Enter. Use the arrow keys to choose a stage, then press Space or Enter to drop it, or Escape to cancel.",
        },
      }}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-2">
        {board.stages.map((stage, index) => (
          <BoardColumn
            key={stage.id}
            stage={stage}
            index={index}
            cards={cardsIn(stage.id)}
            total={board.truncated?.[stage.id]}
          />
        ))}
      </div>
    </DndContext>
  );
}

function BoardColumn({
  stage,
  index,
  cards,
  total,
}: {
  stage: BoardStage;
  index: number;
  cards: BoardApplication[];
  /** Set when the column shows only the newest cards. */
  total?: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { stageId: stage.id } });

  return (
    <section
      ref={setNodeRef}
      aria-label={stage.name}
      data-stage-index={index}
      className={cn(
        "flex w-64 shrink-0 flex-col gap-2 rounded-lg border bg-muted/30 p-2",
        isOver && "border-primary",
      )}
    >
      <header className="flex items-center justify-between px-1 py-1 text-sm">
        <span className="font-semibold">{stage.name}</span>
        <span className="text-muted-foreground">{total ?? cards.length}</span>
      </header>
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-16 flex-col gap-2">
          {cards.map((card) => (
            <BoardCard key={card.id} card={card} />
          ))}
        </div>
      </SortableContext>
      {total !== undefined && (
        <Link href="?view=list" className="px-1 text-xs text-muted-foreground underline">
          Show all in list view
        </Link>
      )}
    </section>
  );
}

function CardDetails({ card }: { card: BoardApplication }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <Badge variant="outline" title="Fit score" className="px-1.5 py-0 font-normal">
        {card.fitScore ?? "–"}
      </Badge>
      <span>{card.daysInStage}d in stage</span>
      {card.ratingAvg !== null && (
        <span title="Average rating" className="inline-flex items-center gap-0.5">
          <Star className="h-3 w-3" aria-hidden />
          {card.ratingAvg.toFixed(1)}
        </span>
      )}
      {card.noteCount > 0 && (
        <span>
          {card.noteCount} note{card.noteCount === 1 ? "" : "s"}
        </span>
      )}
      {card.knockoutReasons && (
        <KnockoutBadge knockout={{ failed: true, reasons: card.knockoutReasons.map((label) => ({ label })) }} />
      )}
    </div>
  );
}

function BoardCard({ card }: { card: BoardApplication }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, data: { stageId: card.stageId } });

  return (
    <div
      ref={setNodeRef}
      data-card
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex items-start gap-2 rounded-md border bg-background p-3 text-sm",
        isDragging && "relative z-10 opacity-80",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Move ${card.name}`}
        className="mt-0.5 cursor-grab touch-none text-muted-foreground"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <Link href={`/company/applicants/${card.id}`} className="block truncate font-medium hover:underline">
          {card.name}
        </Link>
        <CardDetails card={card} />
      </div>
    </div>
  );
}

function MobileBoard({ board, cardsIn, onMove }: BoardProps) {
  const [stageId, setStageId] = useState(board.stages[0]?.id ?? "");
  const cards = cardsIn(stageId);
  const total = board.truncated?.[stageId];

  return (
    <div className="flex flex-col gap-3">
      <Select value={stageId} onValueChange={setStageId}>
        <SelectTrigger className="w-full" aria-label="Stage">
          <SelectValue placeholder="Choose a stage" />
        </SelectTrigger>
        <SelectContent>
          {board.stages.map((stage) => (
            <SelectItem key={stage.id} value={stage.id}>
              {stage.name} ({board.truncated?.[stage.id] ?? cardsIn(stage.id).length})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {cards.length === 0 ? (
        <p className="rounded-lg border px-4 py-6 text-center text-sm text-muted-foreground">
          No applications in this stage.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => (
            <li key={card.id} className="flex items-start gap-3 rounded-md border p-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/company/applicants/${card.id}`}
                  className="block truncate font-medium hover:underline"
                >
                  {card.name}
                </Link>
                <CardDetails card={card} />
              </div>
              <Select value="" onValueChange={(id) => onMove(card.id, id)}>
                <SelectTrigger className="h-8 w-[120px]" aria-label={`Move ${card.name} to…`}>
                  <SelectValue placeholder="Move to…" />
                </SelectTrigger>
                <SelectContent>
                  {board.stages
                    .filter((s) => s.id !== stageId)
                    .map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      )}
      {total !== undefined && (
        <Link href="?view=list" className="text-xs text-muted-foreground underline">
          Show all in list view
        </Link>
      )}
    </div>
  );
}
