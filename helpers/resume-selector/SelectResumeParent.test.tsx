import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SelectResumeParent } from "./SelectResumeParent";

function resume(id: string, name: string, created_at: string, extra = {}) {
  return { id, name, created_at, is_primary: false, parsing_failed: false, ...extra };
}

function renderList(resumes: ReturnType<typeof resume>[], selectedId: string | null = null) {
  const onSelectExisting = vi.fn();
  const onFileChange = vi.fn();
  render(
    <SelectResumeParent
      existingResumes={resumes}
      selectedId={selectedId}
      onSelectExisting={onSelectExisting}
      onFileChange={onFileChange}
    />,
  );
  return { onSelectExisting, onFileChange };
}

const names = () => screen.getAllByRole("option").map((o) => o.getAttribute("title"));

describe("SelectResumeParent", () => {
  it("lists the primary resume first, then newest first", () => {
    renderList([
      resume("a", "Old", "2026-01-01"),
      resume("b", "Newest", "2026-09-01"),
      resume("c", "Primary", "2025-05-01", { is_primary: true }),
    ]);
    expect(names()).toEqual(["Primary", "Newest", "Old"]);
    expect(screen.getAllByRole("img", { name: "Primary resume" })).toHaveLength(1);
  });

  it("hides the search box for a short list", () => {
    renderList([resume("a", "One", "2026-01-01")]);
    expect(screen.queryByLabelText("Search resumes")).toBeNull();
  });

  it("filters a long list by name, case-insensitively", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      resume(`r${i}`, i === 3 ? "Frontend Engineer" : `Generic ${i}`, `2026-0${i + 1}-01`),
    );
    renderList(many);
    fireEvent.change(screen.getByLabelText("Search resumes"), {
      target: { value: "  FRONTEND " },
    });
    expect(names()).toEqual(["Frontend Engineer"]);

    fireEvent.change(screen.getByLabelText("Search resumes"), {
      target: { value: "nothing" },
    });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/No resumes match/)).toBeInTheDocument();
  });

  it("selects a resume and clears any uploaded file", () => {
    const { onSelectExisting, onFileChange } = renderList(
      [resume("a", "One", "2026-01-01"), resume("b", "Two", "2026-02-01")],
      "a",
    );
    expect(screen.getByRole("option", { name: /One/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("option", { name: /Two/ }));
    expect(onFileChange).toHaveBeenCalledWith(null);
    expect(onSelectExisting).toHaveBeenCalledWith("b");
  });

  it("flags resumes that couldn't be parsed", () => {
    renderList([resume("a", "Broken", "2026-01-01", { parsing_failed: true })]);
    expect(screen.getByRole("img", { name: "Couldn't read this resume" })).toBeInTheDocument();
  });
});
