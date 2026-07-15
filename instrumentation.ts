// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const v8 = await import("v8");
    const fs = await import("fs");

    setInterval(() => {
      const mem = process.memoryUsage();
      const usedMB = mem.rss / 1024 / 1024;
      console.log(
        `[mem] rss=${usedMB.toFixed(0)}MB heap=${(mem.heapUsed / 1024 / 1024).toFixed(0)}MB`,
      );

      if (usedMB > 400 && !fs.existsSync("/tmp/heapdump-taken")) {
        const snapshotPath = v8.writeHeapSnapshot();
        fs.writeFileSync("/tmp/heapdump-taken", snapshotPath);
        console.log(`[mem] Heap snapshot written: ${snapshotPath}`);
      }
    }, 30_000);
  }
}
