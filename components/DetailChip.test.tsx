import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { chipListText, DetailChip } from "./DetailChip";

describe("chipListText", () => {
  it("joins a short list", () => {
    expect(chipListText(["React", "SQL"])).toBe("React, SQL");
    expect(chipListText(["React", "SQL", "Python"])).toBe("React, SQL, Python");
  });

  it("shows the first few and counts the rest", () => {
    const skills = [
      "Data Analysis",
      "Software Development",
      "Communication",
      "Leadership",
      "Problem Solving",
      "SQL",
    ];
    expect(chipListText(skills)).toBe("Data Analysis, Software Development, Communication +3");
    expect(chipListText(skills, 1)).toBe("Data Analysis +5");
  });

  it("skips blanks and handles no list", () => {
    expect(chipListText([" React ", "", null, "SQL"])).toBe("React, SQL");
    expect(chipListText(null)).toBe("");
    expect(chipListText(undefined)).toBe("");
  });
});

describe("DetailChip", () => {
  it("keeps long text on one line inside the pill", () => {
    render(<DetailChip title="Skills: everything">A very long value</DetailChip>);

    const text = screen.getByText("A very long value");
    expect(text).toHaveClass("truncate");
    expect(text.parentElement).toHaveClass("max-w-full", "rounded-full");
    expect(text.parentElement).toHaveAttribute("title", "Skills: everything");
  });
});
