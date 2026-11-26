import { Suspense, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/utils/utils";

// The pieces every route's `loading.tsx` is built from. Each one has the shape
// of the shared component it stands in for (`PageHeader`, `SectionHeader`,
// `DataTable`, `EntityLayout`…), so the page doesn't jump when it arrives.
// Server-safe. Only `SkeletonPage` announces itself: don't nest it.

const items = (count: number) => Array.from({ length: count }, (_, index) => index);

/** The outer wrapper of a loading page: the page's own padding, and one status for screen readers. */
export function SkeletonPage({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div role="status" className={cn("mb-20 flex w-full flex-col gap-6 p-4", className)}>
      <span className="sr-only">Loading…</span>
      <SkeletonParts>{children}</SkeletonParts>
    </div>
  );
}

/** The shapes inside a status, hidden from screen readers without adding a box. */
function SkeletonParts({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden className="contents">
      {children}
    </div>
  );
}

/** `PageHeader`: an optional back link and eyebrow, the title, its description and actions. */
export function HeaderSkeleton({
  back,
  eyebrow,
  actions,
}: {
  back?: boolean;
  eyebrow?: boolean;
  actions?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {back && <Skeleton className="my-2 h-4 w-4" />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {eyebrow && <Skeleton className="h-3 w-24" />}
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <ActionsSkeleton count={actions} />
      </div>
    </div>
  );
}

/** `SectionHeader`, on a section page inside an entity's frame. */
export function SectionHeaderSkeleton({ back, actions }: { back?: boolean; actions?: number }) {
  return (
    <div className="flex flex-col gap-2 border-t pt-6">
      {back && <Skeleton className="my-2 h-4 w-4" />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-44 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <ActionsSkeleton count={actions} />
      </div>
    </div>
  );
}

function ActionsSkeleton({ count = 0 }: { count?: number }) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items(count).map((i) => (
        <Skeleton key={i} className="h-10 w-32" />
      ))}
    </div>
  );
}

/** The `AskAgentBox`: its title, the question box and the suggestion chips. */
export function AskBoxSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-7 w-7 rounded-lg" />
        <Skeleton className="h-4 w-48 max-w-full" />
      </div>
      <Skeleton className="h-14 w-full rounded-2xl" />
      <div className="flex flex-wrap gap-2">
        {["w-52", "w-44", "w-60", "w-40"].map((width) => (
          <Skeleton key={width} className={cn("h-8 max-w-full rounded-[17px]", width)} />
        ))}
      </div>
    </div>
  );
}

/** `DataTable`: the filter toolbar, the bordered table and the pager. */
export function TableSkeleton({
  columns = 4,
  rows = 6,
  filters = 2,
}: {
  columns?: number;
  rows?: number;
  filters?: number;
}) {
  // The first column holds a name, so it's the wide one. Phones show two.
  const cell = (column: number) => cn("h-4", column === 0 ? "flex-[2]" : "flex-1", column > 1 && "hidden sm:block");
  return (
    <div className="flex flex-col gap-4">
      {filters > 0 && (
        <div className="flex gap-4 overflow-hidden p-1">
          {items(filters).map((i) => (
            <Skeleton key={i} className="h-10 w-[150px] shrink-0" />
          ))}
        </div>
      )}
      <div className="divide-y rounded-md border">
        {items(rows + 1).map((row) => (
          <div key={row} className="flex items-center gap-6 px-4 py-4">
            {items(columns).map((column) => (
              <Skeleton key={column} className={cell(column)} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-44" />
      </div>
    </div>
  );
}

/** A bordered list of rows, each a title over a line of detail. */
export function ListSkeleton({ rows = 3, action }: { rows?: number; action?: boolean }) {
  return (
    <div className="divide-y rounded-xl border">
      {items(rows).map((i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-3 w-36 max-w-full" />
          </div>
          {action && <Skeleton className="h-8 w-20 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

/** A heading with a list under it, like a dashboard section. */
export function TitledListSkeleton({ rows, action }: { rows?: number; action?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-6 w-40" />
      <ListSkeleton rows={rows} action={action} />
    </div>
  );
}

/** A bordered card with a heading and a few lines. */
export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border p-4", className)}>
      <Skeleton className="h-5 w-32 max-w-full" />
      {items(lines).map((i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** A grid of equal cards (plans, summary tiles). */
export function CardGridSkeleton({
  count = 3,
  lines = 3,
  className = "md:grid-cols-3",
}: {
  count?: number;
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-6", className)}>
      {items(count).map((i) => (
        <CardSkeleton key={i} lines={lines} />
      ))}
    </div>
  );
}

/** Labelled fields, then the save button. */
export function FormSkeleton({ fields = 5, className }: { fields?: number; className?: string }) {
  return (
    <div className={cn("flex w-full max-w-3xl flex-col gap-5", className)}>
      {items(fields).map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-32" />
    </div>
  );
}

/** A page of text: a resume, a job description, a post. */
export function DocumentSkeleton({ sections = 3, className }: { sections?: number; className?: string }) {
  return (
    <div className={cn("flex w-full flex-col gap-8 rounded-xl border p-6", className)}>
      {items(sections).map((i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ))}
    </div>
  );
}

/** A dashboard: the header, the agent box, a wide column of lists and a side column of cards. */
export function DashboardSkeleton({ eyebrow, actions }: { eyebrow?: boolean; actions?: number }) {
  return (
    <SkeletonPage>
      <HeaderSkeleton eyebrow={eyebrow} actions={actions} />
      <AskBoxSkeleton />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-8 lg:col-span-2">
          <TitledListSkeleton rows={3} action />
          <TitledListSkeleton rows={4} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </div>
      </div>
    </SkeletonPage>
  );
}

/** A main page that is a header over a table. */
export function TablePageSkeleton({
  actions,
  ask = true,
  columns,
  filters,
}: {
  actions?: number;
  /** Whether the page has the agent box under its header. */
  ask?: boolean;
  columns?: number;
  filters?: number;
}) {
  return (
    <SkeletonPage>
      <HeaderSkeleton actions={actions} />
      {ask && <AskBoxSkeleton />}
      <TableSkeleton columns={columns} filters={filters} />
    </SkeletonPage>
  );
}

/**
 * The jobs, companies and profiles feeds: filters on the left, then the
 * header, the tabs and the result cards. `note` is a line over the cards.
 */
export function FeedSkeleton({ header = true, note }: { header?: boolean; note?: ReactNode }) {
  return (
    <div role="status" className="flex w-full items-start gap-5 px-4">
      <span className="sr-only">Loading…</span>
      <div aria-hidden className="hidden w-1/4 flex-col gap-5 px-2 pt-4 lg:flex">
        {items(7).map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
      <div className="flex w-full flex-col pt-4 lg:w-3/4">
        {header && (
          <SkeletonParts>
            <div className="flex flex-col gap-6">
              <HeaderSkeleton />
              <AskBoxSkeleton />
            </div>
          </SkeletonParts>
        )}
        <div aria-hidden className="flex flex-wrap items-center justify-between gap-4 py-6">
          <Skeleton className="h-10 w-56 max-w-full" />
          <Skeleton className="h-10 w-40 max-w-full" />
        </div>
        {note}
        <div aria-hidden className="flex flex-col gap-4">
          {items(5).map((i) => (
            <div key={i} className="flex gap-4 rounded-xl border p-4">
              <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-6 w-24 rounded-full" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * `EntityLayout` while its layout loads: the section sidebar, the entity's
 * header and the first section. For the `loading.tsx` above an entity's
 * folder; inside the folder only the section is loading.
 */
export function EntitySkeleton({
  back = true,
  navItems = 6,
  children,
}: {
  /** Settings is a main page: no back link or title in its sidebar. */
  back?: boolean;
  navItems?: number;
  children?: ReactNode;
}) {
  return (
    <div role="status" className="flex w-full flex-col md:min-h-dvh md:flex-row">
      <span className="sr-only">Loading…</span>
      <div aria-hidden className="hidden w-60 shrink-0 flex-col gap-3 border-r bg-muted/30 p-2 md:flex">
        {back && <Skeleton className="mx-4 my-2 h-4 w-24" />}
        {back && <Skeleton className="mx-4 mb-2 h-4 w-40" />}
        {items(navItems).map((i) => (
          <Skeleton key={i} className="mx-4 my-1.5 h-4 w-32" />
        ))}
      </div>
      <div aria-hidden className="flex gap-3 overflow-hidden border-b px-4 py-3 md:hidden">
        {items(4).map((i) => (
          <Skeleton key={i} className="h-6 w-24 shrink-0" />
        ))}
      </div>
      <div aria-hidden className="mb-20 flex min-w-0 flex-1 flex-col gap-6 p-4">
        <HeaderSkeleton eyebrow={back} />
        {children ?? <SectionParts />}
      </div>
    </div>
  );
}

function SectionParts() {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeaderSkeleton />
      <ListSkeleton rows={4} />
    </div>
  );
}

/** A section page inside a loaded entity frame, which already has the padding. */
export function SectionSkeleton({
  back,
  actions,
  children,
}: {
  back?: boolean;
  actions?: number;
  children?: ReactNode;
}) {
  return (
    <SkeletonPage className="p-0">
      <SectionHeaderSkeleton back={back} actions={actions} />
      {children ?? <ListSkeleton rows={4} />}
    </SkeletonPage>
  );
}

/** The agent: the chats on the left, the conversation and the message box. */
export function ChatSkeleton() {
  return (
    <div role="status" className="flex h-full min-h-0 w-full flex-1">
      <span className="sr-only">Loading…</span>
      <div aria-hidden className="hidden w-64 shrink-0 flex-col gap-3 border-r bg-muted/30 p-3 md:flex">
        <Skeleton className="h-10 w-full" />
        {items(7).map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <ConversationSkeleton className="min-h-[70dvh]" />
    </div>
  );
}

/** The open chat alone, while the agent page's session list is already shown. */
export function ChatAreaSkeleton() {
  return (
    <div role="status" className="flex min-h-0 w-full flex-1 flex-col">
      <span className="sr-only">Loading chat…</span>
      <ConversationSkeleton className="min-h-0 flex-1" />
    </div>
  );
}

function ConversationSkeleton({ className }: { className: string }) {
  return (
    <div aria-hidden className={cn("mx-auto flex w-full max-w-3xl flex-col justify-between gap-6 p-4", className)}>
      <div className="flex flex-col gap-6 pt-6">
        <Skeleton className="h-10 w-2/3 self-end rounded-2xl" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
}

/** A narrow, centred card: sign-in, a payment result, a one-question page. */
export function CenteredCardSkeleton() {
  return (
    <div role="status" className="flex min-h-[80vh] w-full items-center justify-center p-4">
      <span className="sr-only">Loading…</span>
      <div aria-hidden className="w-full max-w-md">
        <FormSkeleton fields={3} className="rounded-xl border p-6" />
      </div>
    </div>
  );
}

/** A client helper that reads the URL, kept in its own boundary so the skeleton never waits for it. */
export function SkeletonNote({ children }: { children: ReactNode }) {
  return (
    <div className="pb-4 text-center text-muted-foreground empty:hidden">
      <Suspense>{children}</Suspense>
    </div>
  );
}
