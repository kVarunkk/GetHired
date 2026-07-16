// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // const v8 = await import("v8");
    // const fs = await import("fs");

    setInterval(() => {
      const m = process.memoryUsage();
      const usedMB = m.rss / 1024 / 1024;
      // console.log(
      //   `[mem] rss=${usedMB.toFixed(0)}MB heap=${(mem.heapUsed / 1024 / 1024).toFixed(0)}MB`,
      // );

      console.log({
        rss: Math.round(usedMB),
        heapUsed: Math.round(m.heapUsed / 1024 / 1024),
        heapTotal: Math.round(m.heapTotal / 1024 / 1024),
        external: Math.round(m.external / 1024 / 1024),
        arrayBuffers: Math.round(m.arrayBuffers / 1024 / 1024),
      });

      // if (usedMB > 400 && !fs.existsSync("/tmp/heapdump-taken")) {
      //   const snapshotPath = v8.writeHeapSnapshot();
      //   fs.writeFileSync("/tmp/heapdump-taken", snapshotPath);
      //   console.log(`[mem] Heap snapshot written: ${snapshotPath}`);
      // }
    }, 30_000);
  }
}
