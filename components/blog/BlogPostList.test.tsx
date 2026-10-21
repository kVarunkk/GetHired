import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BlogPostList from "./BlogPostList";
import type { BlogPostSummary } from "@/helpers/blog/post-types";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

const posts: BlogPostSummary[] = [
  { slug: "a", title: "Old resume tips", image: null, publishedAt: "2025-01-05", type: "job-seekers" },
  { slug: "b", title: "Hire your first engineer", image: null, publishedAt: "2026-03-01", type: "companies" },
  { slug: "c", title: "New resume checker", image: null, publishedAt: "2026-10-21", type: "job-seekers" },
];

const titles = () =>
  screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("BlogPostList", () => {
  it("lists newest first with the date and type", () => {
    render(<BlogPostList posts={posts} />);
    expect(titles()).toEqual([
      "New resume checker",
      "Hire your first engineer",
      "Old resume tips",
    ]);
    expect(screen.getByText("21 Oct 2026")).toBeInTheDocument();
    expect(screen.getAllByText("For companies").length).toBeGreaterThan(0);
  });

  it("sorts oldest first", () => {
    render(<BlogPostList posts={posts} />);
    fireEvent.change(screen.getByLabelText("Sort posts"), {
      target: { value: "oldest" },
    });
    expect(titles()[0]).toBe("Old resume tips");
  });

  it("searches titles by every word", () => {
    render(<BlogPostList posts={posts} />);
    fireEvent.change(screen.getByLabelText("Search posts"), {
      target: { value: "resume new" },
    });
    expect(titles()).toEqual(["New resume checker"]);
  });

  it("filters by type and clears", async () => {
    const user = userEvent.setup();
    render(<BlogPostList posts={posts} />);
    await user.click(screen.getByRole("tab", { name: "For companies" }));
    expect(titles()).toEqual(["Hire your first engineer"]);

    fireEvent.change(screen.getByLabelText("Search posts"), {
      target: { value: "resume" },
    });
    expect(screen.getByText("No posts match your search.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(titles()).toHaveLength(3);
  });
});
