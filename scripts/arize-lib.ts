/**
 * A small Arize AX REST client for the offline scripts
 * (`import-agent-feedback.ts`, `judge-calibration.ts`). Not used by the app.
 *
 * API notes (https://api.arize.com/v2/spec.yaml):
 * - `POST /v2/spans` lists spans newest first. `limit` and `cursor` go in the
 *   query string (a cursor in the body is ignored), and `end_time` must stay
 *   the same on every page.
 * - Spans come back with flat dotted `attributes`, plus `annotations` (human)
 *   and `evaluations` (judges) arrays.
 * - `POST /v2/spans/annotate` upserts by annotation config name, needs the
 *   configs to exist, takes up to 1000 records, a window of at most 31 days,
 *   and rejects the whole request (404) if any span isn't in the window.
 * - Queue record sources cover at most 7 days and 500 records per request.
 * - Most of these endpoints allow 10 requests a minute; a 429 says how long
 *   to wait in `Retry-After`.
 */

export const ARIZE_API = "https://api.arize.com/v2";

/** The `gethired-agent` project (spec §13). */
export const AGENT_PROJECT_ID = "TW9kZWw6MTAzODEwOTA2NjA6Wjg4MA==";

const DAY_MS = 24 * 60 * 60 * 1000;
export const ANNOTATE_MAX_WINDOW_MS = 31 * DAY_MS;
export const QUEUE_SOURCE_MAX_WINDOW_MS = 7 * DAY_MS;

export type ArizeAnnotation = {
  name: string;
  label?: string | null;
  score?: number | null;
  text?: string | null;
  updated_at?: string;
  annotator?: { id?: string; email?: string };
};

export type ArizeEvaluation = {
  name: string;
  label?: string | null;
  score?: number | null;
  explanation?: string | null;
  metadata?: {
    evaluator_id?: string;
    evaluator_version_id?: string;
    task_id?: string;
    run_id?: string;
    timestamp?: string;
  };
};

export type ArizeSpan = {
  name: string;
  kind?: string;
  context: { trace_id: string; span_id: string };
  parent_id?: string;
  start_time: string;
  end_time: string;
  attributes?: Record<string, unknown>;
  annotations?: ArizeAnnotation[];
  evaluations?: ArizeEvaluation[];
};

export type AnnotationValue = { name: string; label?: string; score?: number; text?: string };
export type AnnotateRecord = { record_id: string; values: AnnotationValue[] };

export type CategoricalConfig = {
  name: string;
  values: { label: string; score: number }[];
};

type Fetch = typeof fetch;

export type ArizeClient = ReturnType<typeof createArizeClient>;

export function createArizeClient({
  apiKey,
  spaceId,
  fetchImpl = fetch,
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (line: string) => console.error(line),
}: {
  apiKey: string;
  spaceId: string;
  fetchImpl?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}) {
  async function request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const res = await fetchImpl(`${ARIZE_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 6) {
      const wait = Math.max(1, Number(res.headers.get("retry-after")) || 15);
      log(`Arize rate limit on ${method} ${path.split("?")[0]}; waiting ${wait}s`);
      await sleep(wait * 1000);
      return request(method, path, body, attempt + 1);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const problem = JSON.parse(text) as { title?: string; detail?: string };
        detail = [problem.title, problem.detail].filter(Boolean).join(": ") || text;
      } catch {
        // Not problem+json; keep the raw body.
      }
      throw new Error(`Arize ${method} ${path.split("?")[0]} failed (${res.status}): ${detail.slice(0, 500)}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Every span in the window that matches `filter`, page by page. */
  async function* listSpans({
    projectId = AGENT_PROJECT_ID,
    start,
    end,
    filter,
  }: {
    projectId?: string;
    start: Date;
    end: Date;
    filter?: string;
  }): AsyncGenerator<ArizeSpan> {
    let cursor: string | undefined;
    const body = {
      project_id: projectId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      ...(filter ? { filter } : {}),
    };
    do {
      const query = new URLSearchParams({ limit: "500", ...(cursor ? { cursor } : {}) });
      const page = await request<{
        spans?: ArizeSpan[];
        pagination?: { has_more?: boolean; next_cursor?: string };
      }>("POST", `/spans?${query}`, body);
      for (const span of page.spans ?? []) yield span;
      cursor = page.pagination?.has_more ? page.pagination.next_cursor : undefined;
    } while (cursor);
  }

  /** Upserts human annotations on spans, in requests of at most 1000. */
  async function annotateSpans({
    projectId = AGENT_PROJECT_ID,
    records,
    start,
    end,
  }: {
    projectId?: string;
    records: AnnotateRecord[];
    start: Date;
    end: Date;
  }): Promise<void> {
    if (end.getTime() - start.getTime() > ANNOTATE_MAX_WINDOW_MS) {
      throw new Error("Arize annotates spans in windows of at most 31 days.");
    }
    for (let i = 0; i < records.length; i += 1000) {
      await request("POST", "/spans/annotate", {
        project_id: projectId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        annotations: records.slice(i, i + 1000),
      });
    }
  }

  async function findAnnotationConfig(name: string): Promise<{ id: string; type: string } | undefined> {
    const query = new URLSearchParams({ space_id: spaceId, name });
    const page = await request<{ annotation_configs?: { id: string; name: string; type: string }[] }>(
      "GET",
      `/annotation-configs?${query}`,
    );
    return page.annotation_configs?.find((config) => config.name === name);
  }

  /** The config's id, creating it the first time. An existing one is left as it is. */
  async function ensureCategoricalConfig({ name, values }: CategoricalConfig): Promise<string> {
    const existing = await findAnnotationConfig(name);
    if (existing) return existing.id;
    const created = await request<{ id: string }>("POST", "/annotation-configs", {
      name,
      space_id: spaceId,
      annotation_config_type: "CATEGORICAL",
      values,
      optimization_direction: "MAXIMIZE",
    });
    log(`Created annotation config "${name}"`);
    return created.id;
  }

  async function ensureFreeformConfig(name: string): Promise<string> {
    const existing = await findAnnotationConfig(name);
    if (existing) return existing.id;
    const created = await request<{ id: string }>("POST", "/annotation-configs", {
      name,
      space_id: spaceId,
      annotation_config_type: "FREEFORM",
    });
    log(`Created annotation config "${name}"`);
    return created.id;
  }

  async function createAnnotationQueue({
    name,
    instructions,
    annotationConfigIds,
    annotatorEmails,
  }: {
    name: string;
    instructions: string;
    annotationConfigIds: string[];
    annotatorEmails?: string[];
  }): Promise<string> {
    const created = await request<{ id: string }>("POST", "/annotation-queues", {
      name,
      space_id: spaceId,
      instructions: instructions.slice(0, 5000),
      annotation_config_ids: annotationConfigIds,
      ...(annotatorEmails?.length ? { annotator_emails: annotatorEmails, assignment_method: "all" } : {}),
    });
    return created.id;
  }

  /** Adds spans to a queue: one source per request, within 7 days and 500 spans. */
  async function addSpansToQueue({
    queueId,
    projectId = AGENT_PROJECT_ID,
    spans,
  }: {
    queueId: string;
    projectId?: string;
    spans: { spanId: string; startTime: string }[];
  }): Promise<void> {
    for (const batch of queueSourceBatches(spans)) {
      await request("POST", `/annotation-queues/${encodeURIComponent(queueId)}/records`, {
        record_sources: [
          {
            record_type: "SPAN",
            project_id: projectId,
            start_time: batch.start.toISOString(),
            end_time: batch.end.toISOString(),
            span_ids: batch.spanIds,
          },
        ],
      });
    }
  }

  return {
    request,
    listSpans,
    annotateSpans,
    ensureCategoricalConfig,
    ensureFreeformConfig,
    createAnnotationQueue,
    addSpansToQueue,
  };
}

/**
 * Groups spans into queue record sources: each covers at most 7 days and 500
 * spans, padded by a minute on each side so the boundary spans are found.
 */
export function queueSourceBatches(
  spans: readonly { spanId: string; startTime: string }[],
): { start: Date; end: Date; spanIds: string[] }[] {
  const PAD_MS = 60_000;
  const sorted = [...spans].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const batches: { start: Date; end: Date; spanIds: string[] }[] = [];
  let current: { first: number; last: number; spanIds: string[] } | undefined;
  for (const span of sorted) {
    const at = Date.parse(span.startTime);
    const fits =
      current &&
      current.spanIds.length < 500 &&
      at + PAD_MS - (current.first - PAD_MS) <= QUEUE_SOURCE_MAX_WINDOW_MS;
    if (fits) {
      current!.last = at;
      current!.spanIds.push(span.spanId);
    } else {
      if (current) batches.push(toBatch(current));
      current = { first: at, last: at, spanIds: [span.spanId] };
    }
  }
  if (current) batches.push(toBatch(current));
  return batches;

  function toBatch(c: { first: number; last: number; spanIds: string[] }) {
    return { start: new Date(c.first - PAD_MS), end: new Date(c.last + PAD_MS), spanIds: c.spanIds };
  }
}

/** The client from `ARIZE_API_KEY` / `ARIZE_SPACE_ID`, or an error naming what's missing. */
export function arizeFromEnv(): ArizeClient {
  const apiKey = process.env.ARIZE_API_KEY;
  const spaceId = process.env.ARIZE_SPACE_ID;
  if (!apiKey || !spaceId) {
    throw new Error("Set ARIZE_API_KEY and ARIZE_SPACE_ID (run with `npx tsx --env-file=.env`).");
  }
  return createArizeClient({ apiKey, spaceId });
}

/** A string attribute of a span, or undefined. */
export function attr(span: ArizeSpan, key: string): string | undefined {
  const value = span.attributes?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function arg(name: string, argv: readonly string[] = process.argv): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

export function flag(name: string, argv: readonly string[] = process.argv): boolean {
  return argv.includes(`--${name}`);
}
