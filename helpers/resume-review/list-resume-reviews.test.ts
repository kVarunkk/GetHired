import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { listResumeReviews } from "./list-resume-reviews";

const user = { id: "u1" };

describe("listResumeReviews", () => {
  it("reports each review's status through reviewStatus, without analysis_failed", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("resume_reviews", {
      data: [
        { id: "r1", name: "A", status: "completed", analysis_failed: true, score: null },
        { id: "r2", name: "B", status: null, analysis_failed: null, score: 80 },
        { id: "r3", name: "C", status: "draft", analysis_failed: null, score: null },
      ],
      error: null,
    });

    const reviews = await listResumeReviews(supabase.client, user);

    expect(reviews.map((review) => review.status)).toEqual(["failed", "completed", "draft"]);
    expect(reviews.every((review) => !("analysis_failed" in review))).toBe(true);
  });

  it("throws a database error", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("resume_reviews", { data: null, error: { message: "boom" } });

    await expect(listResumeReviews(supabase.client, user)).rejects.toMatchObject({ message: "boom" });
  });
});
