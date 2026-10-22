import posthog from "@/lib/posthog/client";

// The browser side of helpers/posthog/report-error.ts. ESLint forbids
// console.error in app code, so every logged error also reaches PostHog.

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
 * Use instead of console.error in client code: logs the same arguments and
 * reports them to PostHog error tracking. The first Error is the exception;
 * without one, the first argument is its message.
 */
export function reportClientError(...args: unknown[]): void {
  console.error(...args);
  const found = args.find((arg) => arg instanceof Error);
  const error = found ?? new Error(describe(args[0]));
  posthog.captureException(error, { log_message: args.map(describe).join(" ") });
}

// Script errors from other origins carry no detail, and the ResizeObserver
// warning is harmless browser noise.
const IGNORED = [/^Script error\.?$/, /ResizeObserver loop/];

/**
 * Reports uncaught errors and unhandled promise rejections. Registered with
 * the page (instrumentation-client.ts), before posthog-js loads, so early
 * crashes aren't lost; posthog-js's own autocapture stays off to avoid
 * reporting them twice.
 */
export function listenForUncaughtErrors() {
  window.addEventListener("error", (event) => {
    const message = event.error instanceof Error ? event.error.message : event.message;
    if (!message || IGNORED.some((pattern) => pattern.test(message))) return;
    posthog.captureException(event.error ?? new Error(message), {
      source: "window.onerror",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    const error = reason instanceof Error ? reason : new Error(describe(reason));
    if (IGNORED.some((pattern) => pattern.test(error.message))) return;
    posthog.captureException(error, { source: "unhandledrejection" });
  });
}
