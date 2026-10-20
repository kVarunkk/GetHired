import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import {
  AskAgentAboutCareers,
  AskAgentAboutStages,
  AskAgentAboutTemplates,
  careersSuggestions,
  stagesSuggestions,
} from "./AskAgentAboutSettings";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue({ push: vi.fn() } as never);
});

const labels = (s: { label: string }[]) => s.map((x) => x.label);

describe("settings section agent helpers", () => {
  it("offer stage edits only with settings.stages", () => {
    expect(labels(stagesSuggestions({ canViewStages: false, canEditStages: false }))).toEqual([]);
    expect(labels(stagesSuggestions({ canViewStages: true, canEditStages: false }))).toEqual(["Explain my pipeline"]);
    expect(labels(stagesSuggestions({ canViewStages: true, canEditStages: true }))).toEqual([
      "Add a stage",
      "Reorder my pipeline",
      "Archive a stage",
    ]);
  });

  it("offer careers page edits only with careers.edit", () => {
    expect(labels(careersSuggestions({ canEdit: false }))).toEqual(["Review my careers page"]);
    expect(labels(careersSuggestions({ canEdit: true }))).toEqual([
      "Improve my careers page",
      "Write a Perks section",
      "Get it ready to publish",
    ]);
  });

  it("link every suggestion to the company agent", () => {
    render(
      <>
        <AskAgentAboutStages canViewStages canEditStages />
        <AskAgentAboutTemplates />
        <AskAgentAboutCareers canEdit />
      </>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(9);
    for (const link of links) expect(link.getAttribute("href")).toMatch(/^\/company\/agent\?prompt=/);
  });
});
