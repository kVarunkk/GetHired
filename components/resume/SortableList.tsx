"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";

function SortableRow({
  id,
  label,
  onArrow,
  children,
}: {
  id: string;
  label: string;
  onArrow: (step: -1 | 1) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onArrow(event.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-dragging={isDragging || undefined}
      className="flex items-start gap-1 data-[dragging]:opacity-60"
    >
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 cursor-grab touch-none text-muted-foreground"
        {...attributes}
        {...listeners}
        aria-label={`Move ${label}. Use the up and down arrow keys.`}
        onKeyDown={onKeyDown}
      >
        <GripVertical className="h-4 w-4" />
      </Button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * A reorderable list: drag the handle, or focus it and use the arrow keys.
 * Only this list's handles start a drag, so lists can nest.
 */
export default function SortableList<T extends { id: string }>({
  items,
  label,
  onMove,
  children,
}: {
  items: T[];
  label: (item: T, index: number) => string;
  onMove: (id: string, index: number) => void;
  children: (item: T, index: number) => ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const index = items.findIndex((item) => item.id === over.id);
    if (index !== -1) onMove(String(active.id), index);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-3">
          {items.map((item, index) => (
            <SortableRow
              key={item.id}
              id={item.id}
              label={label(item, index)}
              onArrow={(step) => {
                const next = index + step;
                if (next >= 0 && next < items.length) onMove(item.id, next);
              }}
            >
              {children(item, index)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
