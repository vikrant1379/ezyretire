import { Children, isValidElement, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { moveItem } from "@/lib/card-order";

export function SortableCardList({
  ids,
  enabled,
  onReorder,
  children,
}: {
  ids: string[];
  enabled: boolean;
  onReorder: (ids: string[]) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeCard = Children.toArray(children).find(
    (child) => isValidElement<{ id: string }>(child) && child.props.id === activeId,
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!enabled) {
      setActiveId(null);
      return;
    }
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorder(moveItem(ids, String(active.id), String(over.id)));
    }
    // Keep the overlay through the optimistic-order render. Removing it in the
    // same frame briefly exposes the source card in its previous position.
    requestAnimationFrame(() => setActiveId(null));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-4">{children}</div>
      </SortableContext>
      <DragOverlay dropAnimation={null} modifiers={[restrictToVerticalAxis]}>
        {isValidElement<{ children: ReactNode }>(activeCard) ? (
          <div className="flex flex-col gap-4 rounded-xl border border-primary/30 bg-card p-4 pl-9 shadow-xl ring-1 ring-primary/20">
            {activeCard.props.children}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function SortableCard({
  id,
  enabled,
  children,
}: {
  id: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id,
    disabled: !enabled,
    transition: {
      duration: 220,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: isDragging ? undefined : CSS.Transform.toString(transform),
        transition: isDragging ? undefined : transition,
        willChange: transform && !isDragging ? "transform" : undefined,
      }}
      className={cn(
        // Transforms belong to dnd-kit; animating them here fights the drag.
        "group/card relative flex flex-col p-4 rounded-xl border border-border bg-card transition-shadow gap-4",
        enabled ? "pl-9" : "hover:shadow-sm",
        isDragging
          ? "z-10 opacity-0"
          : enabled && "hover:shadow-sm",
        enabled && isOver && !isDragging && "ring-2 ring-primary/40 bg-primary/[0.02]",
      )}
    >
      {enabled ? (
        <button
          type="button"
          aria-label="Drag to reorder"
          className={cn(
            "absolute inset-y-1 left-1 flex w-7 items-center justify-center rounded-lg text-muted-foreground/40",
            "transition-colors hover:bg-muted hover:text-muted-foreground",
            "group-hover/card:text-muted-foreground/70",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:text-muted-foreground",
            "cursor-grab active:cursor-grabbing touch-none",
            isDragging && "bg-muted text-foreground",
          )}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : null}
      {children}
    </div>
  );
}
