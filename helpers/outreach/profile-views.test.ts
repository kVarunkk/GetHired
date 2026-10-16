import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "react-email";
import { createElement } from "react";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { JobDigestEmail } from "@/emails/JobDigestEmail";
import { countProfileViews } from "./profile-views";

vi.mock("server-only", () => ({}));

const USER_ID = "a0000000-0000-4000-8000-000000000001";
let admin: SupabaseMock;

beforeEach(() => {
  admin = createSupabaseMock();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("countProfileViews (ORT-051)", () => {
  it("counts distinct companies in the last 30 days for the user", async () => {
    admin.queue("candidate_profile_views", {
      data: [{ company_id: "c1" }, { company_id: "c2" }, { company_id: "c1" }],
      error: null,
    });

    expect(await countProfileViews(admin.client, USER_ID)).toBe(2);

    const { chain } = admin.callsFor("candidate_profile_views")[0];
    expect(chain).toContainEqual({ method: "eq", args: ["candidate_user_id", USER_ID] });
    expect(chain).toContainEqual({ method: "gt", args: ["viewed_on", "2026-09-16"] });
  });

  it("returns 0 when the query fails, so the digest still goes out", async () => {
    admin.queue("candidate_profile_views", { data: null, error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await countProfileViews(admin.client, USER_ID)).toBe(0);
    spy.mockRestore();
  });
});

describe("JobDigestEmail profile views line (OR-REQ-021)", () => {
  const renderText = (profileViews?: number) =>
    render(createElement(JobDigestEmail, { userName: "Ada", jobs: [], insufficientCredits: false, profileViews }), {
      plainText: true,
    });

  it("mentions the count when it's above 0", async () => {
    expect(await renderText(3)).toMatch(/3 companies viewed your profile in the last 30 days/);
    expect(await renderText(1)).toMatch(/1 company viewed your profile/);
  });

  it("says nothing at 0 or when the count isn't passed", async () => {
    expect(await renderText(0)).not.toMatch(/viewed your profile/);
    expect(await renderText()).not.toMatch(/viewed your profile/);
  });
});
