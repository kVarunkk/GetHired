import { after } from "next/server";
import { PostHog } from "posthog-node";

// Every server-side error goes through here, so all of them reach PostHog
// error tracking. ESLint forbids console.error outside this file and the
// client one (lib/posthog/report-client-error.ts).

let client: PostHog | null = null;

function posthog(): PostHog | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  // `next dev` shares the production project's token, and its errors (mostly
  // half-written code) filled production error tracking. Dev still logs them.
  if (!token || process.env.NODE_ENV !== "production") return null;
  client ??= new PostHog(token, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Turns console.error-style arguments into an exception. The first Error is
 * the exception. Without one, the first string is its message, so a log line
 * with ids after its prefix still groups as one issue. Supabase errors are
 * plain objects, so their `message` is used.
 */
export function toException(args: unknown[]): {
  error: Error;
  properties: Record<string, unknown>;
} {
  const properties: Record<string, unknown> = {
    log_message: args.map(describe).join(" "),
  };
  const found = args.find((arg) => arg instanceof Error);
  if (found) return { error: found as Error, properties };

  const prefix = typeof args[0] === "string" ? args[0] : undefined;
  const detail = args.find(
    (arg): arg is { message: string } =>
      typeof arg === "object" &&
      arg !== null &&
      typeof (arg as { message?: unknown }).message === "string",
  );
  if (detail) properties.error_details = detail;
  const message = prefix ?? detail?.message ?? describe(args[0]);
  return { error: new Error(message), properties };
}

// Digests of the errors Next throws to steer rendering: cookies() during a
// static render attempt (`next build` probes every route), redirect(),
// notFound() and friends. A page's catch block can see them before it
// rethrows; they aren't failures.
const NEXT_CONTROL_FLOW_DIGESTS = [
  "DYNAMIC_SERVER_USAGE",
  "NEXT_REDIRECT",
  "NEXT_NOT_FOUND",
  "NEXT_HTTP_ERROR_FALLBACK",
  "BAILOUT_TO_CLIENT_SIDE_RENDERING",
  "NEXT_PRERENDER_INTERRUPTED",
  "HANGING_PROMISE_REJECTION",
];

export function isNextControlFlowError(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const digest = (value as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    NEXT_CONTROL_FLOW_DIGESTS.some((prefix) => digest.startsWith(prefix))
  );
}

/**
 * Sends an error to PostHog. Inside a request the send is awaited after the
 * response; elsewhere the returned promise can be awaited.
 */
export async function captureServerException(
  error: unknown,
  properties: Record<string, unknown> = {},
  distinctId?: string,
): Promise<void> {
  if (isNextControlFlowError(error)) return;
  const ph = posthog();
  if (!ph) return;
  try {
    ph.captureException(error, distinctId, properties);
    await ph.flush();
  } catch (err) {
    console.error("[posthog] failed to capture exception", err);
  }
}

/**
 * Use instead of console.error: logs the same arguments and reports them to
 * PostHog error tracking.
 */
export function reportError(...args: unknown[]): void {
  if (args.some(isNextControlFlowError)) return;
  console.error(...args);
  const { error, properties } = toException(args);
  const sent = captureServerException(error, properties);
  try {
    // Cloud Run throttles the CPU once the response is sent, so keep the
    // request open until PostHog has the event.
    after(() => sent);
  } catch {
    // Outside a request (e.g. a timer): the send still runs on its own.
  }
}
