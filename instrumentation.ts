export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    setInterval(() => {
      const m = process.memoryUsage();
      const usedMB = m.rss / 1024 / 1024;

      const resources = process.getActiveResourcesInfo();
      const counts = resources.reduce(
        (acc: Record<string, number>, r) => {
          acc[r] = (acc[r] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      console.log({
        rss: Math.round(usedMB),
        heapUsed: Math.round(m.heapUsed / 1024 / 1024),
        heapTotal: Math.round(m.heapTotal / 1024 / 1024),
        external: Math.round(m.external / 1024 / 1024),
        arrayBuffers: Math.round(m.arrayBuffers / 1024 / 1024),
        resourceCounts: counts,
      });
    }, 30_000);
  }
}
