import { gunzipSync } from "zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

let db: SupabaseMock;
const download = vi.fn();
const call = (file: string) => GET(new Request("http://x/feeds/" + file), { params: Promise.resolve({ file }) });

beforeEach(() => {
  db = createSupabaseMock();
  download.mockReset();
  (db.client as unknown as { storage: unknown }).storage = { from: () => ({ download }) };
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
});

describe("GET /feeds/[platform].xml", () => {
  it("serves the stored feed with cache headers", async () => {
    download.mockResolvedValue({ data: new Blob(["<jobs/>"]), error: null });
    const res = await call("jooble.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/xml");
    expect(res.headers.get("Cache-Control")).toContain("s-maxage");
    expect(await res.text()).toBe("<jobs/>");
  });

  it("serves the same feed gzipped at .xml.gz", async () => {
    download.mockResolvedValue({ data: new Blob(["<jobs/>"]), error: null });
    const res = await call("adzuna.xml.gz");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/gzip");
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toBe("<jobs/>");
    expect((await call("nope.xml.gz")).status).toBe(404);
  });

  it("404s an unknown platform or a missing extension without a query", async () => {
    expect((await call("nope.xml")).status).toBe(404);
    expect((await call("jooble")).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("404s a feed that has not been built", async () => {
    download.mockResolvedValue({ data: null, error: { message: "Object not found" } });
    expect((await call("adzuna.xml")).status).toBe(404);
  });
});
