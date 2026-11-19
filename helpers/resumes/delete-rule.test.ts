import { describe, expect, it } from "vitest";
import { resumeDeleteBlockedReason } from "./delete-rule";

describe("resumeDeleteBlockedReason (RE-REQ-037)", () => {
  it("blocks the primary resume", () => {
    expect(resumeDeleteBlockedReason({ isPrimary: true })).toMatch(/primary/);
  });

  it("allows any other resume, even the user's only one", () => {
    expect(resumeDeleteBlockedReason({ isPrimary: false })).toBeNull();
  });
});
