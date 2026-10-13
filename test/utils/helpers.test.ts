import { describe, expect, it, vi } from "vitest";
import { buildRequest } from "./request";
import { mockUser, setRequestUser } from "./auth";
import { createSupabaseMock } from "./supabase-mock";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/get-user-from-request", () => ({
  getUserFromRequest: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

describe("buildRequest", () => {
  it("builds a GET request against localhost with search params", () => {
    const req = buildRequest("/api/jobs", {
      searchParams: { location: "Remote", limit: "20" },
    });

    expect(req.method).toBe("GET");
    expect(req.nextUrl.pathname).toBe("/api/jobs");
    expect(req.nextUrl.searchParams.get("location")).toBe("Remote");
    expect(req.nextUrl.searchParams.get("limit")).toBe("20");
  });

  it("serialises a JSON body and sets the content type", async () => {
    const req = buildRequest("/api/agent/chat", {
      method: "POST",
      body: { sessionId: "s1" },
    });

    expect(req.method).toBe("POST");
    expect(req.headers.get("content-type")).toBe("application/json");
    expect(await req.json()).toEqual({ sessionId: "s1" });
  });

  it("passes custom headers through", () => {
    const req = buildRequest("/api/internal/scraper-state", {
      headers: { "x-api-key": "secret" },
    });

    expect(req.headers.get("x-api-key")).toBe("secret");
  });
});

describe("mockUser", () => {
  it("creates an applicant by default", () => {
    const user = mockUser();

    expect(user.id).toBeTruthy();
    expect(user.app_metadata.type).toBe("applicant");
    expect(user.app_metadata.onboarding_complete).toBe(true);
  });

  it("supports company users and overrides", () => {
    const user = mockUser({ type: "company", id: "c1", email: "hr@acme.dev" });

    expect(user).toMatchObject({
      id: "c1",
      email: "hr@acme.dev",
      app_metadata: { type: "company" },
    });
  });
});

describe("setRequestUser", () => {
  it("makes getUserFromRequest resolve the given user", async () => {
    const user = mockUser({ id: "u1" });

    await setRequestUser(user);

    await expect(getUserFromRequest()).resolves.toBe(user);
  });

  it("can simulate an unauthenticated request", async () => {
    await setRequestUser(null);

    await expect(getUserFromRequest()).resolves.toBeNull();
  });

  it("makes createClient resolve the given Supabase client", async () => {
    const supabase = createSupabaseMock();

    await setRequestUser(mockUser(), supabase.client);

    await expect(createClient()).resolves.toBe(supabase.client);
  });
});
