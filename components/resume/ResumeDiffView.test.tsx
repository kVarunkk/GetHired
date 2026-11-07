import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ResumeDocument } from "@/helpers/resume/render/document";
import { diffResume } from "@/helpers/resumes/resume-diff";
import ResumeDiffView from "./ResumeDiffView";

const document = (bullets: { id: string; text: string }[], extra: Partial<ResumeDocument> = {}): ResumeDocument => ({
  template: "classic",
  name: "Ada Lovelace",
  contact: [{ text: "ada@example.com", href: "mailto:ada@example.com" }],
  sections: [
    {
      id: "work",
      title: "Experience",
      plain: false,
      items: [
        { id: "stripe", title: "Stripe", bullets },
        { id: "acme", title: "Acme", bullets: [{ id: "a1", text: "Ran the team" }] },
        { id: "globex", title: "Globex", bullets: [{ id: "g1", text: "Shipped it" }] },
      ],
    },
  ],
  ...extra,
});

const BEFORE = document([
  { id: "b1", text: "Built the old API" },
  { id: "b2", text: "Wrote docs" },
  { id: "b3", text: "Fixed bugs" },
  { id: "b4", text: "Ran standups" },
]);

const AFTER = document([
  { id: "b1", text: "Built the new API" },
  { id: "b3", text: "Fixed bugs" },
  { id: "b4", text: "Ran standups" },
  { id: "b5", text: "Mentored two engineers" },
]);

const show = (before = BEFORE, after = AFTER) => render(<ResumeDiffView diff={diffResume(before, after)} />);

describe("ResumeDiffView (RI-REQ-004)", () => {
  it("shows the change under its section and entry", () => {
    show();

    expect(screen.getByText("Experience")).toBeInTheDocument();
    expect(screen.getByText("Stripe")).toBeInTheDocument();
  });

  it("collapses what didn't change", () => {
    show();

    expect(screen.getByText("2 unchanged entries")).toBeInTheDocument();
    expect(screen.getByText("2 unchanged bullets")).toBeInTheDocument();
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
    expect(screen.queryByText("Fixed bugs")).not.toBeInTheDocument();
  });

  it("marks word changes with ins and del, not only colour", () => {
    const { container } = show();

    expect(container.querySelector("del")).toHaveTextContent("old");
    expect(container.querySelector("ins")).toHaveTextContent("new");
  });

  it("marks an added bullet with a plus, and a removed one with a strikethrough", () => {
    show();

    expect(screen.getByText("Mentored two engineers").closest("ins")).toHaveTextContent("+ Added: Mentored two engineers");
    expect(screen.getByText("Wrote docs").closest("del")).toHaveClass("line-through");
  });

  it("says when a part moved", () => {
    const first = { id: "b1", text: "One" };
    const second = { id: "b2", text: "Two" };
    const third = { id: "b3", text: "Three" };

    show(document([first, second, third]), document([third, first, second]));

    expect(screen.getByText("(moved)")).toBeInTheDocument();
  });

  it("shows a contact change, and hides an unchanged contact line", () => {
    const { unmount } = show();
    expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument();
    unmount();

    show(BEFORE, { ...BEFORE, headline: "Staff engineer" });
    expect(screen.getByText("Staff engineer")).toBeInTheDocument();
  });

  it("shows the whole resume in the full view", async () => {
    show();

    await userEvent.click(screen.getByRole("button", { name: "Full view" }));

    const full = within(await screen.findByRole("article", { name: "Resume with changes" }));
    expect(full.getByText("Acme")).toBeInTheDocument();
    expect(full.getByText("Fixed bugs")).toBeInTheDocument();
    expect(full.getByText("Wrote docs")).toBeInTheDocument();
    expect(full.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("keeps resume text inert, links included (RI-SEC-003)", async () => {
    const { baseElement } = show(
      document([{ id: "b1", text: "Old" }]),
      document([{ id: "b1", text: "<img src=x onerror=alert(1)> **bold**" }]),
    );

    await userEvent.click(screen.getByRole("button", { name: "Full view" }));
    await screen.findByRole("article", { name: "Resume with changes" });

    expect(baseElement.querySelector("img")).toBeNull();
    expect(baseElement.querySelector("strong")).toBeNull();
    expect(baseElement.querySelector("a")).toBeNull();
  });
});
