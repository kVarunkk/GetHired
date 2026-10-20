import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicClient } from "@/lib/supabase/public";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { getSitemapData } from "./sitemap-data";

vi.mock("@/lib/supabase/public", () => ({ createPublicClient: vi.fn() }));
vi.mock("@keystatic/core/reader", () => ({
  createReader: () => ({ collections: { posts: { all: async () => [{ slug: "hello" }] } } }),
}));
vi.mock("@/app/keystatic.config", () => ({ default: {} }));

let db: SupabaseMock;
beforeEach(() => {
  db = createSupabaseMock();
  vi.mocked(createPublicClient).mockReturnValue(db.client);
  db.queue("all_jobs", { data: null, count: 3, error: null } as never);
  db.queue("countries_and_cities", { data: [{ country: "India" }], error: null });
  db.queue("company_info", { data: [{ careers_slug: "acme" }, { careers_slug: null }], error: null });
});

describe("getSitemapData careers pages (CP-REQ-011)", () => {
  it("adds published careers pages only", async () => {
    const data = await getSitemapData();
    expect(data.staticPaths).toContain("/careers/acme");
    expect(data.staticPaths.filter((p) => p.startsWith("/careers/"))).toEqual(["/careers/acme"]);
    expect(db.callsFor("company_info")[0].chain).toContainEqual({ method: "eq", args: ["careers_published", true] });
  });
});
