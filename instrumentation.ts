import type { Instrumentation } from "next";

// Uncaught errors in pages, layouts, route handlers and server actions. Errors
// a route catches itself are reported with reportError
// (helpers/posthog/report-error.ts).
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureServerException } = await import(
    "@/helpers/posthog/report-error"
  );
  await captureServerException(error, {
    source: "onRequestError",
    path: request.path,
    method: request.method,
    router_kind: context.routerKind,
    route_path: context.routePath,
    route_type: context.routeType,
    render_source: context.renderSource,
    digest: (error as { digest?: string }).digest,
  });
};

export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "production"
  ) {
    const v8 = await import("node:v8");
    setInterval(() => {
      const m = process.memoryUsage();
      const h = v8.getHeapStatistics();

      console.log("=== Memory ===");
      console.log({
        rss: Math.round(m.rss / 1024 / 1024),
        heapUsed: Math.round(m.heapUsed / 1024 / 1024),
        heapTotal: Math.round(m.heapTotal / 1024 / 1024),
        external: Math.round(m.external / 1024 / 1024),
        arrayBuffers: Math.round(m.arrayBuffers / 1024 / 1024),
        heapLimit: Math.round(h.heap_size_limit / 1024 / 1024),
        malloced: Math.round(h.malloced_memory / 1024 / 1024),
        peakMalloced: Math.round(h.peak_malloced_memory / 1024 / 1024),
      });
      const resources = process.getActiveResourcesInfo();
      const counts = resources.reduce(
        (acc: Record<string, number>, r) => {
          acc[r] = (acc[r] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      console.log("resourceCounts:", counts);

      console.table(
        v8.getHeapSpaceStatistics().map((s) => ({
          space: s.space_name,
          usedMB: Math.round(s.space_used_size / 1024 / 1024),
          sizeMB: Math.round(s.space_size / 1024 / 1024),
        })),
      );
    }, 30000);
  }
}
