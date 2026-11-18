import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { RECRUITER_TOOL_PERMISSIONS } from "@/helpers/agent/roles/recruiter/tools/permissions";
import {
  AskAgentAboutDistribution,
  DISTRIBUTION_CHIP_TOOLS,
  distributionPrompt,
  distributionSuggestions,
} from "./AskAgentAboutDistribution";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const JOB = { id: "b0000000-0000-4000-8000-000000000001", title: "Backend Engineer" };
let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

const labels = (s: { label: string }[]) => s.map((x) => x.label);

describe("AskAgentAboutDistribution (MPT-041)", () => {
  it("maps every chip to a recruiter tool, gated by that tool's permission", () => {
    const gates: Record<keyof typeof DISTRIBUTION_CHIP_TOOLS, string> = {
      "Why isn't it live?": "distribution.view",
      "Publish on more boards": "distribution.manage",
    };
    for (const [label, tool] of Object.entries(DISTRIBUTION_CHIP_TOOLS)) {
      const permission = RECRUITER_TOOL_PERMISSIONS[tool];
      expect(permission, tool).toBeDefined();
      expect(permission.keys as readonly string[], label).toContain(gates[label as keyof typeof gates]);
    }
    for (const { label } of distributionSuggestions(JOB, { canManage: true })) {
      expect(Object.keys(DISTRIBUTION_CHIP_TOOLS)).toContain(label);
    }
  });

  it("hides the chip the viewer's permissions don't allow", () => {
    expect(labels(distributionSuggestions(JOB, { canManage: true }))).toEqual(["Why isn't it live?", "Publish on more boards"]);
    expect(labels(distributionSuggestions(JOB, { canManage: false }))).toEqual(["Why isn't it live?"]);
  });

  it("puts the job id in every prompt", () => {
    for (const { prompt } of distributionSuggestions(JOB, { canManage: true })) {
      expect(prompt).toContain(`(job post ${JOB.id})`);
    }
  });

  it("opens the company agent with the question", () => {
    render(<AskAgentAboutDistribution job={JOB} canManage />);
    fireEvent.change(screen.getByLabelText("Question for the assistant"), { target: { value: " Leave it off Jooble " } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(push).toHaveBeenCalledWith(agentPromptHref(distributionPrompt(JOB, "Leave it off Jooble"), COMPANY_AGENT_PATH));
  });
});
