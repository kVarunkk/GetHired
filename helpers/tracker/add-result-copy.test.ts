import { describe, expect, it } from "vitest";
import { addResultView } from "./add-result-copy";

describe("addResultView (AT-REQ-036)", () => {
  it("says Saved for a board favorite and a saved tracked row", () => {
    expect(addResultView({ ok: true, kind: "favorite", allJobsId: "j" })).toMatchObject({ message: "Saved", href: "/my-jobs?tab=saved" });
    expect(addResultView({ ok: true, kind: "tracked", created: true, moved: false, id: "t", status: "saved" })).toMatchObject({
      message: "Saved",
      href: "/my-jobs?tab=saved",
    });
  });

  it("says Added to Applications and links the card", () => {
    expect(addResultView({ ok: true, kind: "tracked", created: true, moved: false, id: "t", status: "applied" })).toEqual({
      tone: "success",
      message: "Added to Applications",
      href: "/my-jobs/applications/t",
    });
  });

  it("says Moved to Applications for a saved card that's now applied", () => {
    expect(addResultView({ ok: true, kind: "tracked", created: false, moved: true, id: "t", status: "applied" }).message).toBe(
      "Moved to Applications",
    );
  });

  it("points at the existing card", () => {
    expect(addResultView({ ok: true, kind: "tracked", created: false, moved: false, id: "t", status: "applied" })).toMatchObject({
      tone: "info",
      href: "/my-jobs/applications/t",
    });
  });

  it("links a GetHired application the user already made, and shows other refusals as errors", () => {
    expect(addResultView({ ok: false, reason: "applied_on_gethired", applicationId: "a", error: "x" })).toMatchObject({
      tone: "info",
      href: "/my-jobs/applications/a",
    });
    expect(addResultView({ ok: false, reason: "platform_job", error: "no" })).toEqual({ tone: "error", message: "no", href: null });
  });
});
