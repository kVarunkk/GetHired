import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn(), sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));

let db: SupabaseMock;

const run = (handler: typeof GET, secret: string | null = "test-secret") =>
  handler(
    buildRequest("/api/updates/outreach/expire", {
      method: handler === POST ? "POST" : "GET",
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
});

describe("/api/updates/outreach/expire (ORT-035)", () => {
  it.each([
    ["no", null],
    ["a wrong", "nope"],
  ])("401s with %s secret", async (_, secret) => {
    expect((await run(POST, secret)).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it.each([
    ["POST", POST],
    ["GET", GET],
  ])("%s expires outreach with the service role and returns the count", async (_, handler) => {
    db.queueRpc("expire_outreach", { data: 4, error: null });

    const res = await run(handler);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ expired: 4 });
    expect(db.callsFor("expire_outreach")).toHaveLength(1);
  });

  it("reports an RPC error and returns 500", async () => {
    db.queueRpc("expire_outreach", { data: null, error: { message: "boom" } });

    const res = await run(POST);

    expect(res.status).toBe(500);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});
