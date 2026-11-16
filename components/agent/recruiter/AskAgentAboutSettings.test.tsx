import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import {
  AskAgentAboutCareers,
  AskAgentAboutStages,
  AskAgentAboutTemplates,
  careersSuggestions,
  jobPipelineSuggestions,
  stagesSuggestions,
} from "./AskAgentAboutSettings";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue({ push: vi.fn() } as never);
});

const labels = (s: { label: string }[]) => s.map((x) => x.label);

describe("settings section agent helpers", () => {
  it("offer pipeline and stage edits only with settings.stages", () => {
    expect(labels(stagesSuggestions({ canViewStages: false, canEditStages: false }))).toEqual([]);
    expect(labels(stagesSuggestions({ canViewStages: true, canEditStages: false }))).toEqual(["Explain my pipelines"]);
    expect(labels(stagesSuggestions({ canViewStages: true, canEditStages: true }))).toEqual([
      "Create a pipeline",
      "Add a stage",
      "Reorder stages",
      "Archive a stage",
    ]);
  });

  it("name the pipeline on its editor, so the agent edits that one (JPT-037)", () => {
    const pipeline = { id: "9e000000-0000-4000-8000-000000000002", name: "Engineering" };
    const suggestions = stagesSuggestions({ canViewStages: true, canEditStages: true, pipeline });

    expect(labels(suggestions)).toEqual(["Add a stage", "Reorder stages", "Archive a stage"]);
    for (const s of suggestions) {
      expect(s.prompt).toContain(`the "Engineering" pipeline (pipeline ${pipeline.id})`);
    }
    expect(labels(stagesSuggestions({ canViewStages: true, canEditStages: false, pipeline }))).toEqual([
      "Explain this pipeline",
    ]);
    // On the list, the agent picks the pipeline first.
    const add = stagesSuggestions({ canViewStages: true, canEditStages: true }).find((s) => s.label === "Add a stage");
    expect(add?.prompt).toMatch(/List my pipelines and ask which one first/);
  });

  it("offer a job's pipeline switch and customizing by permission (JPT-035)", () => {
    const base = {
      job: { id: "b0000000-0000-4000-8000-000000000001", title: "Backend Engineer" },
      pipelineName: "Default",
      canViewStages: true,
    };
    expect(labels(jobPipelineSuggestions({ ...base, canSwitch: true, canCustomize: true }))).toEqual([
      "Switch this job to another pipeline",
      "Add a stage just for this job",
    ]);
    expect(labels(jobPipelineSuggestions({ ...base, canSwitch: true, canCustomize: false }))).toEqual([
      "Switch this job to another pipeline",
    ]);
    expect(labels(jobPipelineSuggestions({ ...base, canSwitch: false, canCustomize: false }))).toEqual([
      "Explain this job's pipeline",
    ]);
    expect(labels(jobPipelineSuggestions({ ...base, canViewStages: false, canSwitch: false, canCustomize: false }))).toEqual(
      [],
    );
    for (const s of jobPipelineSuggestions({ ...base, canSwitch: true, canCustomize: true })) {
      expect(s.prompt).toContain(`"Backend Engineer" (job post ${base.job.id})`);
    }
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
    expect(links).toHaveLength(10);
    for (const link of links) expect(link.getAttribute("href")).toMatch(/^\/company\/agent\?prompt=/);
  });
});
