import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath, revalidateTag } from "next/cache";
import { revalidateCacheAction } from "./revalidate-tag";
import { revalidatePathAction } from "./revalidate-path";

const ID = "d0000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("revalidateCacheAction", () => {
  // The tags real callers use: useJobPostingStatus / summarize-job, JobApplicationForm.
  it.each([`job-${ID}`, `profile-${ID}`])("revalidates the allowlisted tag %s", async (tag) => {
    expect(await revalidateCacheAction(tag)).toEqual({ success: true });
    expect(revalidateTag).toHaveBeenCalledWith(tag);
  });

  it.each(["", "jobs", "job-", "job-123", `job-${ID}x`, `company-${ID}`, `profile-${ID}/x`, "/"])(
    "rejects %j",
    async (tag) => {
      expect(await revalidateCacheAction(tag)).toEqual({ success: false });
      expect(revalidateTag).not.toHaveBeenCalled();
    },
  );
});

describe("revalidatePathAction", () => {
  it("revalidates a job page", async () => {
    expect(await revalidatePathAction(`/jobs/${ID}`)).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/jobs/${ID}`);
  });

  it.each(["/", "/company", "/jobs", "/jobs/not-a-uuid", `/jobs/${ID}/../..`, "anything"])(
    "rejects %j",
    async (path) => {
      expect(await revalidatePathAction(path)).toEqual({ success: false });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});
