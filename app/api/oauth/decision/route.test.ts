import { beforeEach, describe, expect, it, vi } from "vitest";

const approveAuthorization = vi.fn();
const denyAuthorization = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { oauth: { approveAuthorization, denyAuthorization } },
  }),
}));

import { POST } from "./route";

const CALLBACK = "https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz";

function decide(fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return POST(new Request("http://localhost:3000/api/oauth/decision", { method: "POST", body }));
}

describe("POST /api/oauth/decision", () => {
  beforeEach(() => {
    approveAuthorization.mockReset();
    denyAuthorization.mockReset();
  });

  // claude.ai's callback only takes GET; a 307 would replay the form POST there.
  it("redirects an approval to the client with 303, so the browser follows with GET", async () => {
    approveAuthorization.mockResolvedValue({ data: { redirect_url: CALLBACK }, error: null });

    const res = await decide({ decision: "approve", authorization_id: "auth-1" });

    expect(approveAuthorization).toHaveBeenCalledWith("auth-1");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(CALLBACK);
  });

  it("redirects a denial with 303 too", async () => {
    denyAuthorization.mockResolvedValue({ data: { redirect_url: `${CALLBACK}&error=access_denied` }, error: null });

    const res = await decide({ decision: "deny", authorization_id: "auth-1" });

    expect(denyAuthorization).toHaveBeenCalledWith("auth-1");
    expect(res.status).toBe(303);
  });

  it("answers 400 without an authorization_id", async () => {
    const res = await decide({ decision: "approve" });

    expect(res.status).toBe(400);
    expect(approveAuthorization).not.toHaveBeenCalled();
  });

  it("answers 400 when Supabase refuses the decision", async () => {
    approveAuthorization.mockResolvedValue({ data: null, error: { message: "expired" } });

    const res = await decide({ decision: "approve", authorization_id: "auth-1" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expired" });
  });
});
