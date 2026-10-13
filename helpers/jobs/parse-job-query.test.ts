import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { parseJobQuery } from "./parse-job-query";
import { mockGenerateModel } from "@/test/utils/ai";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { google } from "@ai-sdk/google";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";

vi.mock("@ai-sdk/google", () => ({ google: vi.fn() }));
vi.mock("@/helpers/ai/deduct-user-credits", () => ({ deductUserCreditsHelper: vi.fn() }));

let supabase: SupabaseMock;

beforeEach(() => {
  supabase = createSupabaseMock();
});

describe("parseJobQuery", () => {
  it("parses filters with an injected model and deducts credits", async () => {
    supabase.queue("user_info", { data: { ai_credits: 5 }, error: null });
    const model = mockGenerateModel(JSON.stringify({ location: ["Remote"] }));

    const result = await parseJobQuery(supabase.client, "u1", "remote jobs", { model });

    expect(result).toEqual({ ok: true, filters: { location: ["Remote"] } });
    expect(google).not.toHaveBeenCalled();
    expect(deductUserCreditsHelper).toHaveBeenCalledWith(supabase.client, "u1", 5);
  });

  it("defaults to the Gemini flash-lite model", async () => {
    supabase.queue("user_info", { data: { ai_credits: 5 }, error: null });
    vi.mocked(google).mockReturnValue(mockGenerateModel("{}") as never);

    const result = await parseJobQuery(supabase.client, "u1", "jobs");

    expect(result).toEqual({ ok: true, filters: {} });
    expect(google).toHaveBeenCalledWith("gemini-3.1-flash-lite");
  });

  it("returns 404 when the profile is missing", async () => {
    const result = await parseJobQuery(supabase.client, "u1", "jobs", {
      model: mockGenerateModel("{}"),
    });

    expect(result).toEqual({ ok: false, status: 404, error: "User not found." });
  });

  it("returns 402 below the credit threshold without calling the model", async () => {
    supabase.queue("user_info", { data: { ai_credits: 4 }, error: null });
    const model = mockGenerateModel("{}");

    const result = await parseJobQuery(supabase.client, "u1", "jobs", { model });

    expect(result).toEqual({
      ok: false,
      status: 402,
      error: "Insufficient AI credits. Please top up to continue.",
    });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("throws model errors without deducting", async () => {
    supabase.queue("user_info", { data: { ai_credits: 5 }, error: null });
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("boom");
      },
    });

    await expect(parseJobQuery(supabase.client, "u1", "jobs", { model })).rejects.toThrow(
      "boom",
    );
    expect(deductUserCreditsHelper).not.toHaveBeenCalled();
  });
});
