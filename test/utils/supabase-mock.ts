import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

export type MockResponse = {
  data: unknown;
  error: unknown;
  count?: number | null;
  status?: number;
};

export type RecordedCall = {
  kind: "from" | "rpc";
  schema: string;
  /** Table name for `from`, function name for `rpc`. */
  target: string;
  /** Every builder method invoked, in order (`select`, `eq`, `single`, ...). */
  chain: { method: string; args: unknown[] }[];
};

type QueuedResponse = MockResponse | ((call: RecordedCall) => MockResponse);

const EMPTY: MockResponse = { data: null, error: null };

/**
 * A fake `SupabaseClient<Database>` for unit tests.
 *
 * Every `from(...)` / `rpc(...)` chain is recorded in `calls`. Awaiting a chain
 * resolves the next response queued for that table (or rpc), in FIFO order,
 * falling back to `{ data: null, error: null }`.
 *
 * @example
 * const mock = createSupabaseMock({ user: { id: "u1" } });
 * mock.queue("resumes", { data: [{ id: "r1" }], error: null });
 * await listResumes(mock.client, "u1");
 * expect(mock.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["user_id", "u1"] });
 */
export function createSupabaseMock(options: { user?: Partial<User> | null } = {}) {
  const calls: RecordedCall[] = [];
  const queues = new Map<string, QueuedResponse[]>();
  let user = (options.user ?? null) as User | null;

  const key = (kind: RecordedCall["kind"], schema: string, target: string) =>
    `${kind}:${schema}:${target}`;

  const resolveFor = (call: RecordedCall): MockResponse => {
    const next = queues.get(key(call.kind, call.schema, call.target))?.shift();
    if (!next) return EMPTY;
    return typeof next === "function" ? next(call) : next;
  };

  // A thenable query builder: any method call is recorded and returns the
  // builder again; awaiting it resolves the queued response.
  const createBuilder = (call: RecordedCall): unknown => {
    const builder: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (
              onFulfilled?: (value: MockResponse) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) => Promise.resolve(resolveFor(call)).then(onFulfilled, onRejected);
          }
          if (typeof prop === "symbol") return undefined;
          return (...args: unknown[]) => {
            call.chain.push({ method: prop, args });
            return builder;
          };
        },
      },
    );
    return builder;
  };

  const forSchema = (schema: string) => ({
    from: (table: string) => {
      const call: RecordedCall = { kind: "from", schema, target: table, chain: [] };
      calls.push(call);
      return createBuilder(call);
    },
    rpc: (fn: string, params?: unknown) => {
      const call: RecordedCall = {
        kind: "rpc",
        schema,
        target: fn,
        chain: [{ method: "rpc", args: params === undefined ? [fn] : [fn, params] }],
      };
      calls.push(call);
      return createBuilder(call);
    },
  });

  const client = {
    ...forSchema("public"),
    schema: (name: string) => forSchema(name),
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
    },
  } as unknown as SupabaseClient<Database>;

  const enqueue = (k: string, response: QueuedResponse) => {
    const list = queues.get(k) ?? [];
    list.push(response);
    queues.set(k, list);
  };

  return {
    client,
    calls,
    /** Queue the response for the next awaited `from(table)` chain. */
    queue(table: string, response: QueuedResponse, schema = "public") {
      enqueue(key("from", schema, table), response);
    },
    /** Queue the response for the next awaited `rpc(fn)` call. */
    queueRpc(fn: string, response: QueuedResponse, schema = "public") {
      enqueue(key("rpc", schema, fn), response);
    },
    /** Recorded calls for one table or rpc name. */
    callsFor(target: string) {
      return calls.filter((c) => c.target === target);
    },
    setUser(next: Partial<User> | null) {
      user = next as User | null;
    },
    reset() {
      calls.length = 0;
      queues.clear();
    },
  };
}

export type SupabaseMock = ReturnType<typeof createSupabaseMock>;
