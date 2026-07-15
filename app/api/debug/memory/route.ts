// app/api/debug/memory/route.ts
export async function GET() {
  const mem = process.memoryUsage();
  return Response.json({
    rss: +(mem.rss / 1024 / 1024).toFixed(1),
    heapUsed: +(mem.heapUsed / 1024 / 1024).toFixed(1),
    external: +(mem.external / 1024 / 1024).toFixed(1),
  });
}
