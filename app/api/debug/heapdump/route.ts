// app/api/debug/heapdump/route.ts
import v8 from "v8";

export async function GET() {
  const snapshotPath = v8.writeHeapSnapshot(); // writes to /tmp on Render
  const fs = await import("fs");
  const data = fs.readFileSync(snapshotPath);
  return new Response(data, {
    headers: { "Content-Type": "application/octet-stream" },
  });
}
