// app/api/debug/memory/route.ts
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const token = process.env.HEAPDUMP_TOKEN;
  if (!token || req.headers.get("x-debug-token") !== token) {
    return new Response("Forbidden", { status: 403 });
  }

  const mem = process.memoryUsage();
  return Response.json({
    rss: +(mem.rss / 1024 / 1024).toFixed(1),
    heapUsed: +(mem.heapUsed / 1024 / 1024).toFixed(1),
    external: +(mem.external / 1024 / 1024).toFixed(1),
    arrayBuffers: +(mem.arrayBuffers / 1024 / 1024).toFixed(1),
  });
}
