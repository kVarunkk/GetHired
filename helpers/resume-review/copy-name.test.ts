import { describe, expect, it } from "vitest";
import { RESUME_LIMITS } from "@/helpers/resume/config";
import { tailoredCopyName } from "./copy-name";

const source = { resumeName: "Backend", job: null, focus: null, pastedJob: false };

describe("tailoredCopyName", () => {
  it("names the job and company, else the job alone", () => {
    expect(tailoredCopyName({ ...source, job: { title: "AI Engineer", company: "Acme" } }, [])).toBe(
      "Backend – AI Engineer at Acme",
    );
    expect(tailoredCopyName({ ...source, job: { title: "AI Engineer", company: null } }, [])).toBe(
      "Backend – AI Engineer",
    );
  });

  it("uses the focus, cut short, without a job", () => {
    const name = tailoredCopyName({ ...source, focus: "Make it fit senior platform engineering roles at fintechs" }, []);
    expect(name).toBe("Backend – Make it fit senior platform engineering…");
  });

  it("says a pasted job or a plain improvement otherwise", () => {
    expect(tailoredCopyName({ ...source, pastedJob: true }, [])).toBe("Backend – Pasted job");
    expect(tailoredCopyName(source, [])).toBe("Backend – Improved");
    expect(tailoredCopyName({ ...source, resumeName: null }, [])).toBe("Untitled resume – Improved");
  });

  it("adds the first free number when the name is taken, ignoring case", () => {
    expect(tailoredCopyName(source, ["backend – improved"])).toBe("Backend – Improved (2)");
    expect(tailoredCopyName(source, ["Backend – Improved", "Backend – Improved (2)", null])).toBe(
      "Backend – Improved (3)",
    );
  });

  it("stays within the name limit, suffix included", () => {
    const long = "x".repeat(RESUME_LIMITS.shortFieldChars);
    const name = tailoredCopyName({ ...source, resumeName: long }, [`${long.slice(0, RESUME_LIMITS.shortFieldChars - 1)}…`]);
    expect(name.length).toBeLessThanOrEqual(RESUME_LIMITS.shortFieldChars);
  });
});
