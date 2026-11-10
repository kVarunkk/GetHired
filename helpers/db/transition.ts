import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

/**
 * Guarded lifecycle writes (SM-REQ-001, plan/state-machines/feature-state-machines-spec.md).
 *
 * Every status change names the states it may start from, and reports
 * whether a row actually moved, so the caller acts only on a transition that
 * happened (SM-REQ-002). A worker that claimed its row passes the claim
 * (`claimed_at`), so a run that was re-queued under it can't write its result
 * (SM-REQ-003).
 */

type Tables = Database["public"]["Tables"];
type TableName = keyof Tables;
type Row<T extends TableName> = Tables[T]["Row"];
type Update<T extends TableName> = Tables[T]["Update"];

/** Columns whose value is a string, i.e. the ones a lifecycle can live in. */
type StateColumn<T extends TableName> = {
  [K in keyof Row<T>]-?: NonNullable<Row<T>[K]> extends string ? K : never;
}[keyof Row<T>] &
  string;

type StateOf<T extends TableName, C extends StateColumn<T>> = NonNullable<Row<T>[C]>;

type NonEmpty<S> = readonly [S, ...S[]];

/** The other columns a move of `table`'s `column` may write. */
export type TransitionPatch<
  T extends TableName,
  C extends StateColumn<T> = "status" & StateColumn<T>,
> = Omit<Update<T>, C>;

export type TransitionSpec<T extends TableName, C extends StateColumn<T>> = {
  /** The states the row may be in for this move. Never empty. */
  from: NonEmpty<StateOf<T, C>>;
  to: StateOf<T, C>;
  /** Other columns written with the move. */
  patch?: Omit<Update<T>, C>;
};

// The generated table types are too deep for TypeScript to follow through a
// generic table name, so the query runs on an untyped builder; the arguments
// are checked by the signatures above.
type LooseBuilder = {
  update(values: Record<string, unknown>): LooseBuilder;
  eq(column: string, value: unknown): LooseBuilder;
  in(column: string, values: readonly unknown[]): LooseBuilder;
  is(column: string, value: null): LooseBuilder;
  select(columns: string): PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
};

function loose(admin: SupabaseClient<Database>, table: TableName): LooseBuilder {
  return (admin as unknown as { from(t: string): LooseBuilder }).from(table);
}

function assertFrom(from: readonly unknown[]) {
  if (from.length === 0) throw new Error("transition: `from` must name at least one state");
}

/**
 * Moves one row (by `id`) from one of `from` to `to`. Returns
 * `{ applied: false }` when the row isn't in an allowed state (or, with a
 * claim, was claimed again since). `claim: null` matches a row with no claim.
 * Throws on a database error.
 */
export async function transition<T extends TableName, C extends StateColumn<T> = "status" & StateColumn<T>>(
  admin: SupabaseClient<Database>,
  table: T,
  target: { id: string; column?: C; claim?: string | null },
  spec: TransitionSpec<T, C>,
): Promise<{ applied: boolean }> {
  assertFrom(spec.from);
  const column = target.column ?? "status";

  let query = loose(admin, table)
    .update({ [column]: spec.to, ...(spec.patch as Record<string, unknown> | undefined) })
    .eq("id", target.id)
    .in(column, spec.from);
  if (target.claim === null) query = query.is("claimed_at", null);
  else if (target.claim !== undefined) query = query.eq("claimed_at", target.claim);

  const { data, error } = await query.select("id");
  if (error) throw new Error(`Couldn't move ${table} ${target.id} to ${String(spec.to)}: ${error.message}`);
  return { applied: (data?.length ?? 0) > 0 };
}

/**
 * The bulk form: moves every row whose `key` is in `ids` (and that matches
 * every `match` column) from one of `from` to `to`, and returns the keys of
 * the rows that moved. Needs `ids` or `match`, so it never updates a whole
 * table by mistake. An empty `ids` does nothing.
 */
export async function transitionMany<
  T extends TableName,
  C extends StateColumn<T> = "status" & StateColumn<T>,
  K extends StateColumn<T> = "id" & StateColumn<T>,
>(
  admin: SupabaseClient<Database>,
  table: T,
  target: {
    ids?: readonly string[];
    key?: K;
    match?: Partial<Row<T>>;
    column?: C;
  },
  spec: TransitionSpec<T, C>,
): Promise<{ applied: string[] }> {
  assertFrom(spec.from);
  if (target.ids === undefined && target.match === undefined) {
    throw new Error("transitionMany: pass ids or match");
  }
  if (target.ids !== undefined && target.ids.length === 0) return { applied: [] };

  const column = target.column ?? "status";
  const key = target.key ?? "id";

  let query = loose(admin, table).update({
    [column]: spec.to,
    ...(spec.patch as Record<string, unknown> | undefined),
  });
  if (target.ids !== undefined) query = query.in(key, target.ids);
  for (const [name, value] of Object.entries(target.match ?? {})) query = query.eq(name, value);
  query = query.in(column, spec.from);

  const { data, error } = await query.select(key);
  if (error) throw new Error(`Couldn't move ${table} rows to ${String(spec.to)}: ${error.message}`);
  return { applied: (data ?? []).map((row) => String(row[key])) };
}

/**
 * The `.or()` filter for a worker's give-up write (SM-REQ-003): it may move
 * any row but one another run holds under a live claim. So the row is not
 * `processing`, or its claim is missing, dead (older than `liveForMs`) or
 * this run's own. Without it, a run that throws on its last attempt would
 * write `failed` over a newer run (a re-queue's), whose result its claim
 * check would then refuse.
 */
export function notUnderLiveClaim(options: {
  column?: string;
  claim: string;
  liveForMs: number;
  now?: number;
}): string {
  const column = options.column ?? "status";
  const cutoff = new Date((options.now ?? Date.now()) - options.liveForMs).toISOString();
  return [
    `${column}.neq.processing`,
    "claimed_at.is.null",
    `claimed_at.lte."${cutoff}"`,
    `claimed_at.eq."${options.claim}"`,
  ].join(",");
}

/** The tables a worker claims rows of (SM-REQ-003): they have `claimed_at`. */
type ClaimTable = {
  [T in TableName]: "claimed_at" extends keyof Row<T> ? T : never;
}[TableName];

export type ClaimResult =
  /** The row is this run's: go ahead, and finish with `claim`. */
  | "claimed"
  /** Another run holds a live claim: do nothing and leave the message. */
  | "busy"
  /** The row moved under us, or is in a state this run doesn't start from. */
  | "lost";

/**
 * Claims a row for a worker run (SM-REQ-003): moves it into `processing`
 * and sets `claimed_at` to `claim` (the time the worker read the message).
 * The write is a compare-and-swap on what the worker read: the state, or for
 * a dead run, the old claim. So of two runs that read the same row, one wins.
 *
 * A `processing` row whose claim is younger than `liveForMs` (the worker's
 * visibility timeout) belongs to a live run and is left alone; an older claim,
 * or none (a row from before claims existed), is a dead run and is re-claimed.
 * The run's final write then goes through `transition` with
 * `{ from: ["processing"] }` and the same `claim`.
 */
export async function claimForRun<
  T extends ClaimTable,
  C extends StateColumn<T> = "status" & StateColumn<T>,
>(
  admin: SupabaseClient<Database>,
  table: T,
  row: { id: string; state: string; claimedAt: string | null },
  options: {
    /** States a run may start from, besides a dead `processing`. */
    from: readonly StateOf<T, C>[];
    claim: string;
    liveForMs: number;
    column?: C;
    patch?: Omit<Update<T>, C | "claimed_at">;
    now?: number;
  },
): Promise<ClaimResult> {
  const column = options.column;
  const patch = { ...(options.patch as Record<string, unknown> | undefined), claimed_at: options.claim };
  const processing = "processing" as StateOf<T, C>;

  if (row.state === "processing") {
    const age = row.claimedAt === null ? Infinity : (options.now ?? Date.now()) - Date.parse(row.claimedAt);
    if (age < options.liveForMs) return "busy";
    const { applied } = await transition<T, C>(
      admin,
      table,
      { id: row.id, column, claim: row.claimedAt },
      { from: [processing], to: processing, patch: patch as TransitionSpec<T, C>["patch"] },
    );
    return applied ? "claimed" : "lost";
  }

  const state = row.state as StateOf<T, C>;
  if (!options.from.includes(state)) return "lost";
  const { applied } = await transition<T, C>(
    admin,
    table,
    { id: row.id, column },
    { from: [state], to: processing, patch: patch as TransitionSpec<T, C>["patch"] },
  );
  return applied ? "claimed" : "lost";
}
